import { test, expect } from "@playwright/test";
import { open, setSource } from "./helpers.mjs";

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
    IF client->check_on_init( ) IS NOT INITIAL.
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
