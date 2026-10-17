import { test, expect } from "@playwright/test";
import { getSource, MAIN_CLASS, open, setSource } from "./helpers.mjs";

// "Check against UI5" in the bar (src/shell/ui5-floor.mjs): the abap2UI5
// linter's floor, the same setting the abap2UI5 lint tab writes - one source
// of truth with two faces, kept in step both ways, stored the same way, and
// the check run again on a change.

// A view with an icon that OpenUI5 only has from 1.96 on: reported below that
// floor, silent from it up - and abaplint has nothing to say either way.
const withIcon = (icon) => `CLASS ${MAIN_CLASS} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
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
ENDCLASS.`;
const iconRow = (page) => page.locator(".insight-row", { hasText: /icon-too-new/ });
const LINTER_KEY = "abap2ui5-playground:abap2ui5-lint";

test("the bar's UI5 select is the lint tab's ui5, both ways, and re-runs the check", async ({ page }) => {
  await open(page);
  const floor = page.locator("#ui5-floor");
  await expect(floor).toBeEnabled();
  await expect(floor).toHaveValue("1.71");
  const offered = await floor.locator("option").evaluateAll((all) => all.map((o) => o.value));
  expect(offered.slice(0, 5)).toEqual(["1.71", "1.84", "1.96", "1.108", "1.120"]);
  expect(offered[5]).toMatch(/^1\.\d{3}$/);
  await expect(floor.locator("option").nth(5)).toHaveText(/^latest/);

  await setSource(page, withIcon("accessibility"));
  await expect(iconRow(page).first()).toBeVisible({ timeout: 20000 });

  // Raised here: the finding goes, the status says so, the tab shows it and
  // the setting is stored exactly as an Apply would store it.
  await floor.selectOption("1.120");
  await expect(page.locator("#status")).toContainText("checked against UI5 1.120");
  await expect(iconRow(page)).toHaveCount(0);
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LINTER_KEY)).toEqual({ ui5: "1.120", distribution: "openui5" });
  await page.locator('[data-insight="abap2ui5"]').click();
  expect(JSON.parse(await page.locator(".config-text").inputValue()).ui5).toBe("1.120");

  // Changed in the tab: the select follows, including a release not on its list.
  await page.locator(".config-text").fill(JSON.stringify({ ui5: "1.84", distribution: "openui5" }));
  await page.locator(".config-row .primary").click();
  await expect(page.locator(".config-said")).toContainText("applied");
  await expect(floor).toHaveValue("1.84");
  await page.locator(".config-text").fill(JSON.stringify({ ui5: "1.100", distribution: "openui5" }));
  await page.locator(".config-row .primary").click();
  await expect(page.locator(".config-said")).toContainText("applied");
  await expect(floor).toHaveValue("1.100");

  // With the tab open, a change in the bar rewrites its text.
  await floor.selectOption("1.96");
  await expect.poll(async () => JSON.parse(await page.locator(".config-text").inputValue()).ui5).toBe("1.96");

  // Back to the default: forgotten rather than stored, the finding back.
  await floor.selectOption("1.71");
  await expect(page.locator("#status")).toContainText("checked against UI5 1.71");
  expect(await page.evaluate((k) => localStorage.getItem(k), LINTER_KEY)).toBeNull();
  await page.locator('[data-insight="problems"]').click();
  await expect(iconRow(page).first()).toBeVisible({ timeout: 20000 });
  expect(await getSource(page)).toContain("accessibility");
});

test("on a phone the UI5 select is in the toolbar's menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await open(page);
  await expect(page.locator("#ui5-floor")).toBeHidden();
  await page.locator("#toolbar-more").click();
  await expect(page.locator("#toolbar-menu .ui5-floor")).toContainText("Check against UI5");
  await page.locator("#toolbar-menu #ui5-floor").selectOption("1.108");
  await expect(page.locator("#status")).toContainText("checked against UI5 1.108");
  // Choosing a release does not close the menu under the finger - it is a
  // setting, like Auto, whose new state is the thing worth seeing.
  await expect(page.locator("#toolbar-menu")).toBeVisible();
});
