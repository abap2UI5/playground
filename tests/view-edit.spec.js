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

// What the reader sees in the ABAP editor after a small edit, which is the
// other half of "a bind stays a bind": an edit that is correct but arrives as
// a rewrite of the whole method is one nobody can check. The chain is not
// generated again for a change that can be made in place - see
// src/shell/chain-patch.mjs - so the sample's own shape survives it. This
// sample is in the split shape (a statement per subtree, held in variables),
// which a regenerated chain would have collapsed into one.
test("a changed value is the only thing in the file that changes", async ({ page }) => {
  await open(page);
  const area = await openEditor(page);
  const before = await getSource(page, APP);

  const xml = await area.inputValue();
  await area.fill(xml.replace('text="Greet"', 'text="Say hello"'));
  await page.locator("#view-save").click();
  await expect(page.locator("#view-editor")).toHaveCount(0);

  // Byte for byte the file it was, with one literal replaced where it stood.
  const after = await getSource(page, APP);
  expect(after).toBe(before.replace("v = `Greet`", "v = `Say hello`"));
  // Which means, in particular, that the shape the sample is written in is
  // still there rather than flattened into a single chain.
  expect(after).toContain("DATA(page) = view->ele( `Shell`");
});

test("saving without changing anything changes nothing", async ({ page }) => {
  await open(page);
  await openEditor(page);
  const before = await getSource(page, APP);
  await page.locator("#view-save").click();
  await expect(page.locator("#view-editor")).toHaveCount(0);
  expect(await getSource(page, APP)).toBe(before);
});

test("an added attribute rewrites that control's block and nothing else", async ({ page }) => {
  await open(page);
  const area = await openEditor(page);
  const before = await getSource(page, APP);

  const xml = await area.inputValue();
  await area.fill(xml.replace('text="Greet"', 'text="Greet" icon="sap-icon://email"'));
  await page.locator("#view-save").click();
  await expect(page.locator("#view-editor")).toHaveCount(0);

  // The attribute block is written again as a block - the `v =` column is
  // aligned across it, so a line spliced into it would leave the others
  // pointing at nothing - and the block is all that moves.
  const after = await getSource(page, APP);
  expect(after).toBe(
    before.replace(
      "                )->a( n = `press` v = client->_event( `GREET` )\n" +
        "                )->a( n = `text`  v = `Greet` ).",
      "                )->a( n = `press` v = client->_event( `GREET` )\n" +
        "                )->a( n = `text`  v = `Greet`\n" +
        "                )->a( n = `icon`  v = `sap-icon://email` ).",
    ),
  );

  // And the same the other way: taking it out again gives back exactly the
  // file that was there before it went in.
  await expect(page.locator("#view-edit")).toBeEnabled();
  await page.locator("#view-edit").click();
  const grown = page.locator("#view-editor");
  await expect(grown).toBeVisible();
  await grown.fill((await grown.inputValue()).replace(' icon="sap-icon://email"', ""));
  await page.locator("#view-save").click();
  await expect(page.locator("#view-editor")).toHaveCount(0);
  expect(await getSource(page, APP)).toBe(before);
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

  // And it looks refused before it is tried: the pane greys the source back,
  // which is the only thing on screen that says so - Monaco's read-only is
  // otherwise indistinguishable from its editable state.
  await expect(page.locator("#editor")).toHaveClass(/is-readonly/);

  await page.locator("#view-cancel").click();
  await expect(page.locator("#view-editor")).toHaveCount(0);
  // Cancel leaves the ABAP as it was...
  expect(await getSource(page, APP)).toBe(before);
  // ...and hands typing back, colour and all.
  await expect(page.locator("#editor")).not.toHaveClass(/is-readonly/);
  await clickEditor(page);
  await page.keyboard.type("*");
  await page.waitForTimeout(400);
  expect(await getSource(page, APP)).not.toBe(before);
});

// The editor is the one thing in the panel a redraw puts back rather than
// builds again - and a node taken out of the page and put back has lost the
// focus. A Run from inside it (Ctrl+Enter) redraws the panel.
test("a run from inside the view's editor leaves the caret in it", async ({ page }) => {
  await open(page);
  const area = await openEditor(page);
  await area.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("<!-- a");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(area).toBeFocused();
  await page.keyboard.type("b -->");
  expect(await area.inputValue()).toMatch(/<!-- ab -->$/);
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

// A class of the playground's own around a method body, for the cases below
// that need a chain shaped a particular way rather than the sample's.
const viewClass = (body) => `CLASS ${MAIN_CLASS} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
ENDCLASS.

CLASS ${MAIN_CLASS} IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

${body}

  ENDMETHOD.

ENDCLASS.`;

// Opens the View tab's editor on whatever the main file holds, once the view
// it builds is on screen and Edit is on.
async function editMain(page, shown) {
  // Only when it is not the open tab already: a click on the open tab folds
  // the panel away (src/shell/insight.mjs), Edit button and all.
  const tab = page.locator('[data-insight="view"]');
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(page.locator(".view-xml")).toContainText(shown, { timeout: 30000 });
  await expect(page.locator("#view-edit")).toBeEnabled();
  await page.locator("#view-edit").click();
  await expect(page.locator("#view-editor")).toBeVisible();
  return page.locator("#view-editor");
}

async function saveView(page) {
  await page.locator("#view-save").click();
  await expect(page.locator("#view-editor")).toHaveCount(0);
}

// The split shape at its plainest: a control that is the first call of its
// own statement, a wrapped value, a root whose `height` was written before its
// namespaces - and `page->stringify( )`, a chain variable used after the
// chain, which only the full rewrite cannot keep. None of it is a reason for
// an attribute edit to touch more than the block it is in.
const SPLIT = viewClass(`    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`height\`    v = \`100%\`
            )->a( n = \`xmlns\`     v = \`sap.m\`
            )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).

    DATA(page) = view->ele( \`Page\` ).

    page->tag( \`Text\`
        )->a( n = \`text\`  v = \`Lorem ipsum \` &&
                              \`dolor sit amet\`
        )->a( n = \`class\` v = \`sapUiSmallMargin\` ).

    client->view_display( page->stringify( ) ).`);

test("an attribute added where a statement opens, or to a block in front of a wrapped value, moves nothing else", async ({
  page,
}) => {
  await open(page);
  await setSource(page, SPLIT);
  const before = await getSource(page);

  // A control written as the first call of its statement has no `)` opening
  // its line to measure a column from; the block opens one level in from the
  // statement instead, rather than the whole chain being written again.
  let area = await editMain(page, "<Page");
  await area.fill((await area.inputValue()).replace("<Page>", '<Page title="T">'));
  await saveView(page);
  expect(await getSource(page)).toBe(
    before.replace("DATA(page) = view->ele( `Page` ).", "DATA(page) = view->ele( `Page`\n        )->a( n = `title` v = `T` )."),
  );

  // The root's block, written again with one more attribute: in the order the
  // chain has them - the parser lists namespace declarations first, and the
  // block used to follow it - and the new one after them.
  area = await editMain(page, 'title="T"');
  await area.fill((await area.inputValue()).replace('height="100%">', 'height="100%" displayBlock="true">'));
  await saveView(page);
  expect(await getSource(page)).toContain(
    "            )->a( n = `height`       v = `100%`\n" +
      "            )->a( n = `xmlns`        v = `sap.m`\n" +
      "            )->a( n = `xmlns:mvc`    v = `sap.ui.core.mvc`\n" +
      "            )->a( n = `displayBlock` v = `true` ).",
  );

  // And the Text's block, around a value wrapped onto a second line: that
  // value keeps its own text, continuation line and all, and only the padding
  // in front of `v =` moves with the longer name.
  area = await editMain(page, 'displayBlock="true"');
  await area.fill((await area.inputValue()).replace('class="sapUiSmallMargin"', 'class="sapUiSmallMargin" wrapping="false"'));
  await saveView(page);
  const grown = await getSource(page);
  expect(grown).toContain(
    "        )->a( n = `text`     v = `Lorem ipsum ` &&\n" +
      "                              `dolor sit amet`\n" +
      "        )->a( n = `class`    v = `sapUiSmallMargin`\n" +
      "        )->a( n = `wrapping` v = `false` ).",
  );

  // Taking all three out again arrives back at the file that was there.
  area = await editMain(page, 'wrapping="false"');
  await area.fill(
    (await area.inputValue())
      .replace(' title="T"', "")
      .replace(' displayBlock="true"', "")
      .replace(' wrapping="false"', ""),
  );
  await saveView(page);
  expect(await getSource(page)).toBe(before);
});

test("a control added where the method uses a chain variable afterwards is refused at Save, and says why", async ({
  page,
}) => {
  await open(page);
  await setSource(page, SPLIT);
  const before = await getSource(page);
  // Edit is on - an attribute edit is made in place - but a new control means
  // the whole chain as one statement, and `page` would then name nothing.
  const area = await editMain(page, "<Page");
  await area.fill((await area.inputValue()).replace("<Text ", '<Label text="new"/>\n<Text '));
  await page.locator("#view-save").click();
  await expect(page.locator("#view-said")).toContainText("`page` is used after it");
  expect(await getSource(page)).toBe(before);
});

test("deleting one of two controls that read the same but raise different events is refused, not guessed", async ({
  page,
}) => {
  await open(page);
  // Every event shows as `.eB()`, so the two Buttons are the same text on
  // screen - and the one that goes decides whether FIRST or SECOND survives.
  await setSource(
    page,
    viewClass(`    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`     v = \`sap.m\`
            )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\`

            )->ele( \`Page\`

                )->tag( \`Button\`
                    )->a( n = \`text\`  v = \`Go\`
                    )->a( n = \`press\` v = client->_event( \`FIRST\` )

                )->tag( \`Button\`
                    )->a( n = \`text\`  v = \`Go\`
                    )->a( n = \`press\` v = client->_event( \`SECOND\` ) ).

    client->view_display( view->stringify( ) ).`),
  );
  const before = await getSource(page);
  const area = await editMain(page, "<Button");
  const lines = (await area.inputValue()).split("\n");
  lines.splice(
    lines.findIndex((line) => line.includes("<Button")),
    1,
  );
  await area.fill(lines.join("\n"));
  await page.locator("#view-save").click();
  await expect(page.locator("#view-said")).toContainText("cannot be told");
  await expect(page.locator("#view-said")).toHaveClass(/is-error/);
  expect(await getSource(page)).toBe(before);
});

test("a control taken out is taken out where it stands, comments and all", async ({ page }) => {
  await open(page);
  // A comment in the chain is what the full rewrite refuses, and most of
  // abap2UI5/samples has one. A leaf added with `tag( )` is its own lines,
  // so taking it out is cutting those lines and nothing else.
  await setSource(
    page,
    viewClass(`    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`     v = \`sap.m\`
            )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\`

            " the two actions of the page
            )->ele( \`Page\`

                )->tag( \`Button\`
                    )->a( n = \`text\`  v = \`Save\`
                    )->a( n = \`press\` v = client->_event( \`SAVE\` )
                )->tag( \`Button\`
                    )->a( n = \`text\`  v = \`Cancel\`
                    )->a( n = \`press\` v = client->_event( \`CANCEL\` ) ).

    client->view_display( view->stringify( ) ).`),
  );
  const before = await getSource(page);
  const area = await editMain(page, "<Button");
  await area.fill(
    (await area.inputValue())
      .split("\n")
      .filter((line) => !line.includes('text="Cancel"'))
      .join("\n"),
  );
  await saveView(page);
  expect(await getSource(page)).toBe(
    before.replace(
      "\n                )->tag( `Button`\n" +
        "                    )->a( n = `text`  v = `Cancel`\n" +
        "                    )->a( n = `press` v = client->_event( `CANCEL` )",
      "",
    ),
  );
});

// A literal inside a template's embedded expression is one token: the `|` in
// `|{ '|' }x|` does not end the template and the `{` in `|{ '{' }x|` opens no
// brace. Read as either, the rest of the method was swallowed into the
// template and a plain chain was refused as building no view at all.
test("a template with a quoted bar or brace inside its braces is read as one value", async () => {
  const { readViewChain } = await import("../src/shell/chain-read.mjs");
  for (const value of ["|{ '|' }x|", "|{ '{' }x|", "|{ `|` }{ '}' }x|"]) {
    const read = readViewChain(`CLASS x IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    DATA(view) = z2ui5_cl_ui5_view_builder=>factory( ).
    view->ele( \`Page\`
        )->a( n = \`title\` v = ${value}
        )->tag( \`Button\`
        )->a( n = \`text\` v = \`Go\` ).
    client->view_display( view->stringify( ) ).
  ENDMETHOD.
ENDCLASS.`);
    expect(read.ok, `${value}: ${read.why}`).toBe(true);
    expect(read.root.children[0].attrs[0].raw).toBe(value);
    expect(read.root.children[0].children.map((c) => c.name)).toEqual(["Button"]);
  }
});
