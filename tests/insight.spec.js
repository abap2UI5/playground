import { test, expect } from "@playwright/test";
import { getSource, MAIN_CLASS, markers, open, runSample, sampleFiles, setSource } from "./helpers.mjs";

// The panel under the editor: the problems list, the outline, and the second
// checker that feeds the first.

const withIcon = (icon) => `CLASS ${MAIN_CLASS} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
  PROTECTED SECTION.
    METHODS view_display.
ENDCLASS.
CLASS ${MAIN_CLASS} IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    IF client->check_on_init( ).
      DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
          )->ele( n = \`View\` ns = \`mvc\`
              )->a( n = \`xmlns\`     v = \`sap.m\`
              )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).
      view->ele( \`Page\`
          )->a( n = \`title\` v = \`Icons\`
          )->tag( \`Button\`
              )->a( n = \`id\`   v = \`btnIcon\`
              )->a( n = \`icon\` v = \`sap-icon://${icon}\` ).
      client->view_display( view->stringify( ) ).
    ENDIF.
  ENDMETHOD.
  METHOD view_display.
  ENDMETHOD.
ENDCLASS.`;

// The same view, with a Button property that OpenUI5 only grew in 1.84. It is
// the cleanest observable difference between the two UI5 floors: reported at
// 1.71, silent at 1.120, and abaplint has nothing to say about it either way.
const withAriaHasPopup = () =>
  withIcon("accept").replace(
    "              )->a( n = `icon` v = `sap-icon://accept` ).",
    "              )->a( n = `icon` v = `sap-icon://accept`\n" +
      "              )->a( n = `ariaHasPopup` v = `Dialog` ).",
  );

// The row the abap2UI5 linter writes about a property the chosen release does
// not have. Its presence is the observable difference between the two floors.
const tooNewRow = (page) => page.locator(".insight-row", { hasText: /ariaHasPopup/i });

test("the problems list reports what abaplint found, and going to one moves the cursor", async ({ page }) => {
  await open(page);
  await expect(page.locator("#insight")).toBeVisible();
  await expect(page.locator("#insight-body")).toContainText("Nothing to report");

  const broken = (await getSource(page)).replace(
    "PUBLIC SECTION.",
    "PUBLIC SECTION.\n    DATA broken TYPE zcl_does_not_exist.",
  );
  await setSource(page, broken);
  // Where the bad line ended up, worked out rather than counted: the sample is
  // abap2UI5/samples' own and its header may grow a line at any pin.
  const at = broken.split("\n").findIndex((l) => l.includes("zcl_does_not_exist")) + 1;

  const row = page.locator(".insight-row.is-error").first();
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toContainText("abaplint");
  await expect(page.locator("#problem-count")).toHaveText(/[1-9]/);

  await row.click();
  const line = await page.evaluate(() => window.monaco.editor.getEditors()[0].getPosition().lineNumber);
  expect(line, "clicking a problem goes to its line").toBe(at);
});

test("the abap2UI5 linter reports an icon that abaplint is happy with", async ({ page }) => {
  await open(page);

  // Valid ABAP by every measure abaplint has - and an icon that is in no icon
  // font, so the button renders with nothing on it and nothing is logged.
  await setSource(page, withIcon("this-icon-does-not-exist"));

  const row = page.locator(".insight-row", { hasText: "icon font" }).first();
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toContainText("abap2UI5");

  // …and beside the row, the link to the rule's card - the page that says
  // what the finding means and shows the same code fixed.
  const doc = row.locator("xpath=..").locator(".insight-doc");
  await expect(doc).toHaveAttribute("href", /abap2ui5\.github\.io\/linter\/#unknown-icon$/);

  // It is a finding about the view, not about the ABAP: the app still runs,
  // and looking at it is how somebody understands the finding.
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.frameLocator("#app").locator('[id$="--btnIcon"]')).toBeVisible();

  // And with a real icon the finding is gone.
  await setSource(page, withIcon("accept"));
  await expect(page.locator(".insight-row", { hasText: "icon font" })).toHaveCount(0, { timeout: 20000 });
});

test("the outline lists the class and its methods, and clicking one jumps there", async ({ page }) => {
  await open(page);
  await page.locator('[data-insight="outline"]').click();

  const body = page.locator("#insight-body");
  await expect(body).toContainText(MAIN_CLASS);
  // Every abap2UI5 app implements this one, whatever else it has.
  await expect(body).toContainText("main");

  await page.locator(".insight-row", { hasText: "main" }).first().click();
  const line = await page.evaluate(() => window.monaco.editor.getEditors()[0].getPosition().lineNumber);
  const source = await getSource(page);
  expect(source.split("\n")[line - 1].toLowerCase(), "landed on the method").toContain("main");
});

test("clicking the open tab collapses the panel, and clicking again brings it back", async ({ page }) => {
  await open(page);
  const tab = page.locator('[data-insight="problems"]');
  await expect(page.locator("#insight-body")).toBeVisible();

  await tab.click();
  await expect(page.locator("#insight-body")).toBeHidden();

  await tab.click();
  await expect(page.locator("#insight-body")).toBeVisible();
});

test("the toggle folds the panel away, and the choice survives a reload", async ({ page }) => {
  await open(page);
  const body = page.locator("#insight-body");
  const toggle = page.locator("#insight-toggle");
  await expect(body).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const editorBefore = (await page.locator("#editor").boundingBox()).height;
  await toggle.click();
  await expect(body).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // The point of folding it away is the height the editor gets back - and what
  // stays behind is the strip, so the problem count still reports from it.
  const editorAfter = (await page.locator("#editor").boundingBox()).height;
  expect(editorAfter, "the editor got the space").toBeGreaterThan(editorBefore + 60);
  await expect(page.locator('[data-insight="problems"]')).toBeVisible();

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#insight-body"), "still folded away").toBeHidden();

  await page.locator("#insight-toggle").click();
  await expect(page.locator("#insight-body")).toBeVisible();
});

test("on a phone the panel starts folded away, and a failure still opens it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await open(page);

  // Nobody has said either way, and on a screen this size the editor is what
  // the room is for. The strip stays, so it is one tap back.
  await expect(page.locator("#insight-body")).toBeHidden();
  await expect(page.locator("#insight-toggle")).toBeVisible();

  // A failure is not tooling: it takes the room it needs even here.
  await setSource(page, (await getSource(page)).replaceAll(MAIN_CLASS, "zcl_renamed"));
  await page.locator("#run").click();
  await expect(page.locator(".log-body")).toBeVisible({ timeout: 30000 });
});

// A finger is not a mouse: it lands where it lands, a centimetre wide, and
// it does not get a second try at a glyph 26 pixels tall under a drag handle.
// Playwright's touch emulation is what makes `(pointer: coarse)` true, which
// is the query the strip grows under.
test.describe("with a finger", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 760 } });

  test("the toggle is a size a finger can hit, and answers a tap that lands above it", async ({ page }) => {
    await open(page);
    const body = page.locator("#insight-body");
    const toggle = page.locator("#insight-toggle");
    await expect(body).toBeHidden();
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "a finger").toBe(true);

    const box = await toggle.boundingBox();
    expect(box.width, "wide enough for a finger").toBeGreaterThanOrEqual(40);
    expect(box.height, "tall enough for a finger").toBeGreaterThanOrEqual(32);

    // Where the glyph is.
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(body).toBeVisible();

    // A few pixels above it - on the resize grip, and on the editor's bottom
    // edge, where a finger aimed at the glyph as often lands. Before, that
    // press went to the grip and became a drag of nothing. Measured again:
    // opening the panel moved the strip up.
    const opened = await toggle.boundingBox();
    await page.touchscreen.tap(opened.x + opened.width / 2, opened.y - 4);
    await expect(body).toBeHidden();
  });
});

test("an embedded playground does not show the panel", async ({ page }) => {
  await page.goto("/?embed=1");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#insight")).toBeHidden();
});

test("the panel can be dragged taller, and the height survives a reload", async ({ page }) => {
  await open(page);
  const panel = page.locator("#insight");
  const before = (await panel.boundingBox()).height;

  const grip = page.locator("#insight-grip");
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 8 });
  await page.mouse.up();

  const after = (await panel.boundingBox()).height;
  expect(after, "dragging the top edge upwards makes it taller").toBeGreaterThan(before + 60);

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  const restored = (await page.locator("#insight").boundingBox()).height;
  expect(Math.abs(restored - after), "the height came back").toBeLessThan(8);
});

test("the abaplint config decides what the editor reports", async ({ page }) => {
  await open(page);

  // A style rule the playground deliberately does not run - it answers "is this
  // the house style", not "would this work". Nothing says a word about the
  // blank lines until it is switched on, which is the question this tab exists
  // to answer: why is it not warning here?
  await setSource(page, (await page.evaluate(() => window.monaco.editor.getModels()[0].getValue()))
    .replace(/ENDCLASS\.\n+CLASS/, "ENDCLASS.\n\n\n\n\n\n\nCLASS"));
  await expect(page.locator(".insight-row", { hasText: "sequential blank" })).toHaveCount(0);

  await page.locator('[data-insight="abaplint"]').click();
  const box = page.locator(".config-text");
  const config = JSON.parse(await box.inputValue());
  config.rules.sequential_blank = true;
  await box.fill(JSON.stringify(config));
  await page.locator(".config-row .primary").click();

  await expect(page.locator(".config-said")).toContainText("applied", { timeout: 30000 });
  await page.locator('[data-insight="problems"]').click();
  await expect(
    page.locator(".insight-row", { hasText: /sequential blank/i }).first(),
  ).toBeVisible({ timeout: 30000 });
});

test("a config that names a rule abaplint does not have says so", async ({ page }) => {
  await open(page);
  await page.locator('[data-insight="abaplint"]').click();

  const box = page.locator(".config-text");
  const config = JSON.parse(await box.inputValue());
  config.rules.no_such_rule_at_all = true;
  await box.fill(JSON.stringify(config));
  await page.locator(".config-row .primary").click();

  await expect(page.locator(".config-said.is-error")).toContainText("no rule called");
  // And having refused it, the editor still works.
  await expect(page.locator(".config-text")).toBeVisible();
});

test("the abap2UI5 lint config decides which UI5 release the view is held to", async ({ page }) => {
  await open(page);

  // A property sap.m.Button only grew in 1.84, so the default 1.71 floor
  // reports it. This is the assertion that matters: the tab echoing back what
  // was typed into it proves nothing, and for a while it was all this checked -
  // the release was passed to the linter under a name the linter does not read,
  // so the setting reported "applied" and changed nothing at all.
  await setSource(page, withAriaHasPopup());
  await expect(tooNewRow(page).first()).toBeVisible({ timeout: 20000 });

  await page.locator('[data-insight="abap2ui5"]').click();
  const box = page.locator(".config-text");
  expect(JSON.parse(await box.inputValue())).toEqual({ ui5: "1.71", distribution: "openui5" });

  await box.fill(JSON.stringify({ ui5: "not-a-release", distribution: "openui5" }));
  await page.locator(".config-row .primary").click();
  await expect(page.locator(".config-said.is-error")).toContainText("not a UI5 release");

  // Raising the floor makes it go away, and lowering it brings it back.
  await box.fill(JSON.stringify({ ui5: "1.120", distribution: "openui5" }));
  await page.locator(".config-row .primary").click();
  await expect(page.locator(".config-said")).toContainText("applied");
  await page.locator('[data-insight="problems"]').click();
  await expect(tooNewRow(page)).toHaveCount(0);

  await page.locator('[data-insight="abap2ui5"]').click();
  await page.locator(".config-row button", { hasText: "Reset" }).click();
  await expect(page.locator(".config-said")).toContainText("applied");
  expect(JSON.parse(await page.locator(".config-text").inputValue()).ui5).toBe("1.71");
  await page.locator('[data-insight="problems"]').click();
  await expect(tooNewRow(page).first()).toBeVisible({ timeout: 20000 });
});

test("a changed checker setting is still there after a reload", async ({ page }) => {
  await open(page);

  // The UI5 floor, because it is the one somebody has a real reason to move:
  // an app that only has to run on a current system is held to 1.71 by default
  // and is told about properties that are perfectly fine on theirs.
  await setSource(page, withAriaHasPopup());
  await expect(tooNewRow(page).first()).toBeVisible({ timeout: 20000 });

  await page.locator('[data-insight="abap2ui5"]').click();
  await page.locator(".config-text").fill(JSON.stringify({ ui5: "1.120", distribution: "openui5" }));
  await page.locator(".config-row .primary").click();
  await expect(page.locator(".config-said")).toContainText("applied");

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await page.locator('[data-insight="abap2ui5"]').click();
  expect(JSON.parse(await page.locator(".config-text").inputValue()).ui5).toBe("1.120");
  // And it is in force, not merely on screen: the draft came back with it.
  await page.locator('[data-insight="problems"]').click();
  await expect(tooNewRow(page)).toHaveCount(0);

  // Reset puts it back - to the default of the day rather than to a frozen
  // copy of it, which is why a setting that equals the default is forgotten
  // rather than stored.
  await page.locator('[data-insight="abap2ui5"]').click();
  await page.locator(".config-row button", { hasText: "Reset" }).click();
  await expect(page.locator(".config-said")).toContainText("applied");

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await page.locator('[data-insight="abap2ui5"]').click();
  expect(JSON.parse(await page.locator(".config-text").inputValue()).ui5).toBe("1.71");
});

test("an embedded playground does not pick up a stored checker setting", async ({ page }) => {
  await open(page);
  await page.locator('[data-insight="abap2ui5"]').click();
  await page.locator(".config-text").fill(JSON.stringify({ ui5: "1.120", distribution: "openui5" }));
  await page.locator(".config-row .primary").click();
  await expect(page.locator(".config-said")).toContainText("applied");

  // A demo in somebody's documentation has to read the same to every reader -
  // the same reason an embedded playground never restores a draft.
  //
  // Asked of the markers rather than of the Config tab, because an embedded
  // playground tucks the whole panel away: the setting has to be observed
  // through what the linter does with it, which is the thing that matters
  // anyway.
  await page.goto("/?embed=1");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await setSource(page, withAriaHasPopup());

  await expect
    .poll(async () => (await markers(page)).some((m) => /ariaHasPopup/i.test(m.message)), {
      timeout: 20000,
    })
    .toBe(true);
});

test("a stored setting that no longer makes sense is dropped rather than fatal", async ({ page }) => {
  await open(page);

  // What an old deploy could leave behind: a rule abaplint has since dropped.
  // The page has to start on the defaults, not refuse to start.
  await page.evaluate(() =>
    localStorage.setItem(
      "abap2ui5-playground:abaplint",
      JSON.stringify({ version: "v750", rules: { no_such_rule_at_all: true } }),
    ),
  );
  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  await page.locator('[data-insight="abaplint"]').click();
  const config = JSON.parse(await page.locator(".config-text").inputValue());
  expect(config.rules.no_such_rule_at_all).toBeUndefined();
  expect(config.rules.check_syntax).toBe(true);
});

test("the info button opens the credits", async ({ page }) => {
  await open(page);
  await expect(page.locator("#about-dialog")).toBeHidden();

  await page.locator("#about").click();
  const dialog = page.locator("#about-dialog");
  await expect(dialog).toBeVisible();

  // The projects the playground is built on, named and linked.
  for (const project of ["abap2UI5", "abaplint", "open-abap-core", "OpenUI5", "Monaco", "sql.js"]) {
    await expect(dialog).toContainText(project);
  }
  await expect(dialog.locator('a[href*="open-abap"]')).toHaveAttribute("target", "_blank");

  // The credits are about other people's work, so our own projects are not in
  // the list - thanking ourselves there would be the one untrue line in it.
  const credits = dialog.locator(".about-credits");
  await expect(credits).not.toContainText("abap2UI5 linter");
  await expect(credits).toContainText("Monaco");

  await expect(dialog).toContainText("Thank you");
  // Somewhere in the thanks - not pinned to which paragraph - there is
  // something to actually do with it. A thank-you that asks for nothing is a
  // decoration.
  await expect(
    dialog.locator(".about-thanks", { hasText: /star them|open the issue|pull request/ }),
    "the thanks says what to do with it",
  ).toHaveCount(1);
  // And it says which framework version is actually running.
  await expect(page.locator("#about-versions")).toContainText("abap2UI5 ");

  await dialog.locator('button[aria-label="Close"]').click();
  await expect(dialog).toBeHidden();
});

test("collapsing works after the panel has been dragged", async ({ page }) => {
  await open(page);
  const body = page.locator("#insight-body");
  const tab = page.locator('[data-insight="problems"]');

  // Dragging writes the height into the element's style attribute, and an
  // inline style beats a class - so collapsing did nothing at all once the
  // panel had been resized. The drag comes first here on purpose.
  const grip = page.locator("#insight-grip");
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 90, { steps: 6 });
  await page.mouse.up();

  const editorBefore = (await page.locator("#editor").boundingBox()).height;
  await tab.click();
  await expect(body).toBeHidden();

  // The point of collapsing is the height the editor gets back.
  const editorAfter = (await page.locator("#editor").boundingBox()).height;
  expect(editorAfter, "the editor got the space").toBeGreaterThan(editorBefore + 60);

  // And expanding gives back the height that was dragged, not a default.
  await tab.click();
  await expect(body).toBeVisible();
  expect(Math.abs((await page.locator("#editor").boundingBox()).height - editorBefore)).toBeLessThan(8);
});
test("each config tab links to where its rules are documented", async ({ page }) => {
  await open(page);

  await page.locator('[data-insight="abaplint"]').click();
  await expect(page.locator('#insight-body a[href*="rules.abaplint.org"]')).toBeVisible();
  await expect(page.locator('#insight-body a[href*="github.com/abaplint/abaplint"]')).toBeVisible();

  await page.locator('[data-insight="abap2ui5"]').click();
  await expect(page.locator('#insight-body a[href*="github.com/abap2UI5/linter"]')).toBeVisible();
  await expect(page.locator('#insight-body a[href*="npmjs.com"]')).toBeVisible();
  // They leave the playground, so they open where a link should.
  await expect(page.locator("#insight-body a").first()).toHaveAttribute("target", "_blank");
});

test("the log is a tab of the one panel, and an error opens it", async ({ page }) => {
  await open(page);
  // There is one panel at the bottom of the page, not two.
  await expect(page.locator("#insight")).toBeVisible();
  await expect(page.locator("#output"), "the separate output window is gone").toHaveCount(0);

  await page.locator('[data-insight="log"]').click();
  await expect(page.locator("#insight-body")).toContainText("Nothing has gone wrong yet");

  // Something the problems list cannot hold - here a class whose name does not
  // match its file, which abaplint would only report as a filename complaint -
  // has to bring the panel to itself rather than wait to be found.
  await page.locator('[data-insight="outline"]').click();
  await setSource(page, (await getSource(page)).replaceAll(MAIN_CLASS, "zcl_renamed"));
  await page.locator("#run").click();

  await expect(page.locator(".log-body")).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-insight="log"]')).toHaveClass(/is-active/);
  await expect(page.locator("#log-dot")).toHaveText("!");

  // And it can be put away again.
  await page.locator(".log-head button").click();
  await expect(page.locator(".log-body")).toHaveCount(0);
  await expect(page.locator("#log-dot")).toHaveText("");
});

test("an embedded playground keeps the panel away until something goes wrong", async ({ page }) => {
  await page.goto("/?embed=1");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#insight"), "tooling stays out of somebody else's page").toBeHidden();

  // A failure is not tooling: it has to reach the reader even here.
  await setSource(page, (await getSource(page)).replaceAll(MAIN_CLASS, "zcl_renamed"));
  await page.locator("#run").click();
  await expect(page.locator("#insight")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".log-body")).toBeVisible();
});

test("the View tab shows the XML the builder chain makes, and follows the typing", async ({ page }) => {
  await open(page);
  // The hello world rather than the app the page opens on: one Title with a
  // literal text, which is the smallest chain there is to read back. Its
  // file is the one in the editor from here on, not the start page's.
  const [file] = sampleFiles("hello");
  const cls = file.replace(/\.clas\.abap$/, "");
  await runSample(page, "hello");
  await page.locator('[data-insight="view"]').click();
  // The sample's view, one element per line - reconstructed by the abap2UI5
  // linter from the chain, not rendered by the app.
  const xml = page.locator(".view-xml");
  await expect(xml).toContainText('<Title text="Hello World"', { timeout: 30000 });
  const lines = (await xml.textContent()).split("\n");
  expect(lines.length).toBeGreaterThan(5);
  expect(lines[0]).toMatch(/^<mvc:View /);
  // One element per line, indented by depth: the Page's children sit three
  // levels in (mvc:View, Shell, Page).
  expect(lines.some((l) => l.startsWith("      <Title "))).toBe(true);

  // A keystroke changes the chain, and the preview follows it.
  await setSource(page, (await getSource(page, file)).replace("Hello World`", "Hello again`"), file);
  await expect(xml).toContainText('text="Hello again"');

  // A file that builds no view says so instead of showing nothing.
  await setSource(page, `CLASS ${cls} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
ENDCLASS.
CLASS ${cls} IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
  ENDMETHOD.
ENDCLASS.`, file);
  await expect(page.locator("#insight-body")).toContainText("builds no view");
});

test("the panel colours the XML and the JSON it shows", async ({ page }) => {
  await open(page);
  await runSample(page, "hello");
  await page.locator('[data-insight="view"]').click();
  const xml = page.locator(".view-xml");
  await expect(xml).toContainText("<mvc:View", { timeout: 30000 });

  // An element name, an attribute name and a value are three different things
  // and the panel says which is which - see src/shell/highlight.mjs.
  await expect(xml.locator("span.code-tag").first()).toHaveText("mvc:View");
  expect(await xml.locator("span.code-attr").count()).toBeGreaterThan(3);
  await expect(xml.locator("span.code-value").filter({ hasText: "Hello World" }).first()).toBeVisible();

  // Measured rather than asserted on the classes: a token with a class and no
  // colour behind it looks exactly like the grey this replaced, and a palette
  // variable that never reached the stylesheet is precisely how that happens.
  const colours = await xml.evaluate((pre) => {
    const of = (sel) => getComputedStyle(pre.querySelector(sel)).color;
    return { tag: of("span.code-tag"), attr: of("span.code-attr"), value: of("span.code-value") };
  });
  expect(colours.tag).toBe(colours.attr);
  expect(colours.value).not.toBe(colours.tag);

  // Colouring is painting, not editing: the text is the same text, which is
  // what keeps Copy copying a view somebody can paste into a UI5 project.
  const text = await xml.textContent();
  expect(text).toContain('<Title text="Hello World"');

  // The same for the JSON a roundtrip carried, where a key and a string are
  // the two things a reader is looking for in a wall of braces.
  await page.locator('[data-insight="roundtrips"]').click();
  await page.locator(".roundtrip-row").first().click();
  const detail = page.locator(".roundtrip-detail");
  await expect(detail).toBeVisible();
  // The view the answer carried is XML and gets the XML colours; the request
  // and the response beside it are objects and get the JSON ones.
  await expect(detail.locator(".roundtrip-body").first().locator("span.code-tag").first()).toBeVisible();
  expect(await detail.locator("span.code-key").count()).toBeGreaterThan(0);
  expect(await detail.locator("span.code-string").count()).toBeGreaterThan(0);
});
