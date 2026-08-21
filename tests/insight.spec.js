import { test, expect } from "@playwright/test";
import { getSource, open, setSource } from "./helpers.mjs";

// The panel under the editor: the problems list, the outline, and the second
// checker that feeds the first.

const withIcon = (icon) => `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
  PROTECTED SECTION.
    METHODS view_display.
ENDCLASS.
CLASS zcl_playground IMPLEMENTATION.
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

test("the problems list reports what abaplint found, and going to one moves the cursor", async ({ page }) => {
  await open(page);
  await expect(page.locator("#insight")).toBeVisible();
  await expect(page.locator("#insight-body")).toContainText("Nothing to report");

  await setSource(page, (await page.evaluate(() => window.monaco.editor.getModels()[0].getValue()))
    .replace("PUBLIC SECTION.", "PUBLIC SECTION.\n    DATA broken TYPE zcl_does_not_exist."));

  const row = page.locator(".insight-row.is-error").first();
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toContainText("abaplint");
  await expect(page.locator("#problem-count")).toHaveText(/[1-9]/);

  await row.click();
  const line = await page.evaluate(() => window.monaco.editor.getEditors()[0].getPosition().lineNumber);
  expect(line, "clicking a problem goes to its line").toBe(4);
});

test("the abap2UI5 linter reports an icon that abaplint is happy with", async ({ page }) => {
  await open(page);

  // Valid ABAP by every measure abaplint has - and an icon that is in no icon
  // font, so the button renders with nothing on it and nothing is logged.
  await setSource(page, withIcon("this-icon-does-not-exist"));

  const row = page.locator(".insight-row", { hasText: "icon font" }).first();
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toContainText("abap2UI5");

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
  await expect(body).toContainText("zcl_playground");
  await expect(body).toContainText("view_display");

  await page.locator(".insight-row", { hasText: "view_display" }).first().click();
  const line = await page.evaluate(() => window.monaco.editor.getEditors()[0].getPosition().lineNumber);
  const source = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
  expect(source.split("\n")[line - 1].toLowerCase(), "landed on the method").toContain("view_display");
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
  await page.locator('[data-insight="abap2ui5"]').click();

  const box = page.locator(".config-text");
  expect(JSON.parse(await box.inputValue())).toEqual({ ui5: "1.71", distribution: "openui5" });

  await box.fill(JSON.stringify({ ui5: "not-a-release", distribution: "openui5" }));
  await page.locator(".config-row .primary").click();
  await expect(page.locator(".config-said.is-error")).toContainText("not a UI5 release");

  await page.locator(".config-row button", { hasText: "Reset" }).click();
  await expect(page.locator(".config-said")).toContainText("applied");
  expect(JSON.parse(await page.locator(".config-text").inputValue()).ui5).toBe("1.71");
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
  await setSource(page, (await getSource(page)).replace(/zcl_playground/g, "zcl_renamed"));
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
  await setSource(page, (await getSource(page)).replace(/zcl_playground/g, "zcl_renamed"));
  await page.locator("#run").click();
  await expect(page.locator("#insight")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".log-body")).toBeVisible();
});
