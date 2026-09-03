import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { clickEditor, getSource, MAIN_CLASS, open, runSample, sampleFiles, setSource } from "./helpers.mjs";

// The linter itself, to check the layout of what came out rather than to
// describe it. CommonJS, so it comes in through a require.
const { checkAbapSource } = createRequire(import.meta.url)("@abap2ui5/linter");

// The sample these edit, and the file its class lives in.
const SAMPLE = "binding";
const [APP] = sampleFiles(SAMPLE);

// Editing the view instead of the chain that builds it.
//
// The View tab reconstructs the XML a z2ui5_cl_ui5_view_builder chain
// produces; Edit turns that into the other direction - change the XML, and the
// chain is written again to build it (src/shell/view-edit.mjs, chain-read.mjs,
// chain-write.mjs).
//
// The property worth holding onto is not "the XML round-trips": it is that a
// value nobody touched keeps the ABAP that produced it. A regeneration from
// the rendered XML alone would compile and run and quietly be a different app,
// with every `client->_bind( … )` frozen into the string it happened to have.

// The "Data Binding" sample: an Input and a Text bound to one attribute, a
// second Text the backend writes into, and a Button that raises the event.
// Four expressions no rendering could reconstruct, which is what these are
// about - and it is built in the split shape, a statement per subtree, which
// is the shape the reader has to be able to read back.
async function openEditor(page) {
  await runSample(page, SAMPLE);
  await page.locator('[data-insight="view"]').click();
  await expect(page.locator(".view-xml")).toContainText("<Button", { timeout: 30000 });
  await expect(page.locator("#view-edit")).toBeEnabled();
  await page.locator("#view-edit").click();
  await expect(page.locator("#view-editor")).toBeVisible();
  return page.locator("#view-editor");
}

test("a change to the view is written back as a builder chain, and the binds survive it", async ({ page }) => {
  await open(page);
  const area = await openEditor(page);

  const xml = await area.inputValue();
  expect(xml).toContain('text="Greet"');
  // One value changed, one attribute added on the same control.
  await area.fill(xml.replace('text="Greet"', 'text="Say hello" icon="sap-icon://email"'));
  await page.locator("#view-save").click();
  await expect(page.locator("#view-editor")).toHaveCount(0);

  const abap = await getSource(page, APP);
  // What was edited is a literal now...
  expect(abap).toContain("v = `Say hello`");
  expect(abap).toContain("n = `icon`  v = `sap-icon://email`");
  expect(abap).not.toContain("v = `Greet`");
  // ...and what was not is the ABAP it always was. This is the whole point:
  // the reconstruction renders these as `{NAME}` and `.eB()`, and a chain
  // generated from that rendering would have lost every one of them.
  expect(abap).toContain("v = client->_bind( name )");
  expect(abap).toContain("v = client->_bind( greeting )");
  expect(abap).toContain("v = client->_event( `GREET` )");
  // A boolean stays a boolean, on `b =` rather than on `v =`.
  expect(abap).toContain("b = abap_true");
  expect(abap).toContain("b = client->check_app_prev_stack( )");
  // One chain, in the house layout: a call per line opening with `)->`, four
  // spaces a level, and one `).` at the end.
  const chain = abap.slice(abap.indexOf("DATA(view)"), abap.indexOf("client->view_display"));
  expect(chain.trimEnd().endsWith(" )."), "the view ends in a single ).").toBe(true);
  for (const line of chain.split("\n")) {
    // A wrapped value's continuation lines are content, not calls.
    if (line.trim() === "" || line.includes("factory(") || !line.includes(")->")) continue;
    expect(line, "every call opens its own line with )->").toMatch(/^ *\)->/);
    expect(line.length - line.trimStart().length, "four spaces a level").toBe(
      Math.round((line.length - line.trimStart().length) / 4) * 4,
    );
  }

  // And the rule that says all of this, run: `chain-house-layout` is the
  // abap2UI5 linter's own checker for the layout chain-write.mjs writes, so
  // this is the claim being verified rather than restated. Nothing else in the
  // file may be reported either - a rewrite that introduces a finding is a
  // rewrite that broke the sample.
  const { findings } = checkAbapSource(abap, {
    minUi5: "1.71",
    distribution: "openui5",
    rules: { "chain-house-layout": "error" },
  });
  expect(findings.map((f) => `${f.type} at line ${f.line}`)).toEqual([]);

  // And the app that comes out of it is the edited one.
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.frameLocator("#app").getByRole("button", { name: "Say hello" })).toBeVisible();
});

test("a control added in the view becomes a call in the chain", async ({ page }) => {
  await open(page);
  const area = await openEditor(page);

  const xml = await area.inputValue();
  await area.fill(xml.replace("<Button ", '<Label text="and then"/>\n<Button '));
  await page.locator("#view-save").click();
  await expect(page.locator("#view-editor")).toHaveCount(0);

  const abap = await getSource(page, APP);
  expect(abap).toContain("v = `and then`");
  // Inserting in the middle must not shift what follows onto the wrong
  // original - the Button after it still carries its event.
  expect(abap).toContain("v = client->_event( `GREET` )");
  expect(abap).toContain("v = client->_bind( greeting )");

  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.frameLocator("#app").getByText("and then")).toBeVisible();
});

test("the ABAP editor is read-only while the view is open, and writable again after", async ({ page }) => {
  await open(page);
  await openEditor(page);
  const before = await getSource(page, APP);

  // Typing into the ABAP does nothing while the XML is the truth. Measured by
  // what the model holds, because a Monaco readOnly still takes the focus and
  // still shows a caret.
  await clickEditor(page);
  await page.keyboard.type("ZZZ");
  expect(await getSource(page, APP)).toBe(before);

  await page.locator("#view-cancel").click();
  await expect(page.locator("#view-editor")).toHaveCount(0);
  // Cancel leaves the ABAP as it was...
  expect(await getSource(page, APP)).toBe(before);
  // ...and hands typing back.
  await clickEditor(page);
  await page.keyboard.type("*");
  await page.waitForTimeout(400);
  expect(await getSource(page, APP)).not.toBe(before);
});

test("XML that does not parse is refused where it was typed, and nothing is written", async ({ page }) => {
  await open(page);
  const area = await openEditor(page);
  const before = await getSource(page, APP);

  await area.fill("<mvc:View><Page></mvc:View>");
  await page.locator("#view-save").click();
  await expect(page.locator("#view-said")).toContainText("not valid XML");
  await expect(page.locator("#view-said")).toHaveClass(/is-error/);
  // Still open, still holding what was typed, and the ABAP untouched.
  await expect(area).toBeVisible();
  expect(await getSource(page, APP)).toBe(before);

  // Text between two tags is valid XML and still not something the builder can
  // write - it sets attributes, it has no call for a text node.
  await area.fill('<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc"><Text>hello</Text></mvc:View>');
  await page.locator("#view-save").click();
  await expect(page.locator("#view-said")).toContainText("not text between tags");
  expect(await getSource(page, APP)).toBe(before);
});

test("Edit says why it is off for a chain that cannot be rewritten", async ({ page }) => {
  await open(page);
  // A view filled from a LOOP: the XML on screen is one moment of it, and
  // writing that back would replace the loop with the rows it happened to
  // produce. The button is off and carries the sentence that says so.
  await setSource(
    page,
    `CLASS ${MAIN_CLASS} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
ENDCLASS.

CLASS ${MAIN_CLASS} IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`     v = \`sap.m\`
            )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).

    DATA(page) = view->ele( \`Page\`
        )->a( n = \`title\` v = \`Rows\` ).

    DO 3 TIMES.
      page->tag( \`Text\` )->a( n = \`text\` v = \`row\` ).
    ENDDO.

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.`,
  );
  await page.locator('[data-insight="view"]').click();
  await expect(page.locator(".view-xml")).toContainText("<Page", { timeout: 30000 });
  await expect(page.locator("#view-edit")).toBeDisabled();
  await expect(page.locator("#view-edit")).toHaveAttribute("title", /more than a chain/);
});
