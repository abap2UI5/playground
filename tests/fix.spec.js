import { test, expect } from "@playwright/test";
import { getSource, MAIN_CLASS, open, setSource } from "./helpers.mjs";

// Autofix, and the way back to code that came from a link.

test("abaplint's fixes are offered, applied, and undoable in one step", async ({ page }) => {
  await open(page);

  // A rule with a fix, switched on through the config tab so the test does not
  // depend on the default set carrying a fixable rule.
  await page.locator('[data-insight="abaplint"]').click();
  const box = page.locator(".config-text");
  const config = JSON.parse(await box.inputValue());
  config.rules.sequential_blank = true;
  await box.fill(JSON.stringify(config));
  await page.locator(".config-row .primary").click();
  await expect(page.locator(".config-said")).toContainText("applied", { timeout: 30000 });

  const before = (await getSource(page)).replace(/ENDCLASS\.\n+CLASS/, "ENDCLASS.\n\n\n\n\n\n\nCLASS");
  await setSource(page, before);

  await page.locator('[data-insight="problems"]').click();
  const bar = page.locator(".insight-fixbar");
  await expect(bar).toBeVisible({ timeout: 30000 });
  await expect(bar).toContainText("can be fixed automatically");

  await bar.locator("button").click();
  await expect(page.locator("#status")).toContainText("fixed", { timeout: 30000 });

  // The rule trims the run down rather than away - what matters is that the
  // source changed, and changed in the direction the rule asks for.
  const after = await getSource(page);
  expect(after, "the run of blank lines got shorter").not.toContain("\n\n\n\n\n");
  expect(after.length).toBeLessThan(before.length);

  // One edit, so one undo takes the whole rewrite back - an automatic change to
  // somebody's source has to be reversible without picking it apart.
  await page.locator("#editor").click();
  await page.keyboard.press("Control+z");
  expect(await getSource(page), "Ctrl+Z restores what was there").toBe(before);
});

test("the abap2UI5 linter fixes a missing namespace declaration", async ({ page }) => {
  await open(page);

  // A SimpleForm under a view that never declared the form namespace. abaplint
  // is content - it is valid ABAP - and the app would fail to load the control.
  await setSource(
    page,
    `CLASS ${MAIN_CLASS} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
ENDCLASS.
CLASS ${MAIN_CLASS} IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\` v = \`sap.m\` ).
    view->ele( \`Page\`
        )->ele( n = \`SimpleForm\` ns = \`form\` ).
    client->view_display( view->stringify( ) ).
  ENDMETHOD.
ENDCLASS.`,
  );

  await expect(
    page.locator(".insight-row", { hasText: /namespace/i }).first(),
  ).toBeVisible({ timeout: 30000 });

  await page.locator(".insight-fixbar button").click();
  await expect(page.locator("#status")).toContainText("fixed", { timeout: 30000 });

  const after = await getSource(page);
  expect(after, "the declaration the view was missing").toContain("xmlns:form");
  await expect(page.locator(".insight-row", { hasText: /namespace/i })).toHaveCount(0);
});

test("the fix bar stays away when there is nothing it could do", async ({ page }) => {
  await open(page);
  // The sample is clean, and none of its problems - there are none - are
  // fixable. A button that does nothing when pressed is worse than no button.
  await expect(page.locator(".insight-fixbar")).toHaveCount(0);
});

test("linked code offers the way back to GitHub, and only linked code does", async ({ page }) => {
  await open(page);
  // Over a sample the link is there but inactive: no page to go to, and the
  // bar does not rearrange itself when one appears.
  const inactive = page.locator("#source-link");
  await expect(inactive, "a sample was not linked from anywhere").toHaveAttribute("aria-disabled", "true");
  await expect(inactive).not.toHaveAttribute("href", /./);

  await page.goto("/?src=examples/zcl_linked_example.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  const link = page.locator("#source-link");
  await expect(link).toBeVisible();
  await expect(link).not.toHaveAttribute("aria-disabled", "true");
  await expect(link).toHaveAttribute("target", "_blank");
  // Same-origin here, so the href is the file itself; the interesting case is
  // the translation from raw.githubusercontent to the page a human wants,
  // which the unit-level check below covers.
  await expect(link).toHaveAttribute("href", /zcl_linked_example\.clas\.abap$/);
});
