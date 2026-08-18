import { test, expect } from "@playwright/test";
import { control, open, outputText, setSource } from "./helpers.mjs";

// The playground's whole point: what is in the editor is what runs. These tests
// change the ABAP and check that the app on the right changed with it, and that
// the ways it can go wrong say so.

const app = (title, body) => `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
    DATA out TYPE string.
  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.
ENDCLASS.
CLASS zcl_playground IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    me->client = client.
    IF client->check_on_init( ) IS NOT INITIAL.
      ${body}
      view_display( ).
      RETURN.
    ENDIF.
    IF client->check_on_navigated( ) IS NOT INITIAL.
      view_display( ).
    ENDIF.
  ENDMETHOD.
  METHOD view_display.
    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`     v = \`sap.m\`
            )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).
    DATA(page) = view->ele( \`Page\`
        )->a( n = \`title\` v = \`${title}\` ).
    page->tag( \`Text\`
        )->a( n = \`id\`   v = \`txtOut\`
        )->a( n = \`text\` v = client->_bind( out ) ).
    client->view_display( view->stringify( ) ).
  ENDMETHOD.
ENDCLASS.`;

test("editing the ABAP and running shows the new app", async ({ page }) => {
  await open(page);
  await expect(page.frameLocator("#app").getByText("Hello abap2UI5")).toBeVisible();

  await setSource(page, app("Second Version", "out = `written by the editor`."));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });

  await expect(page.frameLocator("#app").getByText("Second Version")).toBeVisible();
  await expect(control(page, "txtOut")).toContainText("written by the editor");
});

test("modern ABAP is compiled without a downport step", async ({ page }) => {
  await open(page);

  // Inline declarations, VALUE # with FOR, COND #, a table expression and a
  // string template - none of which exist in the 702 syntax the transpiler was
  // built around, and all of which it handles.
  await setSource(
    page,
    app(
      "Modern",
      `DATA(rows) = VALUE string_table( FOR i = 1 WHILE i <= 4 ( |row { i }| ) ).
      out = COND #( WHEN lines( rows ) > 3 THEN |{ rows[ 2 ] } of { lines( rows ) }| ELSE \`few\` ).`,
    ),
  );
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });

  await expect(control(page, "txtOut")).toContainText("row 2 of 4");
});

test("a run is refused while the ABAP has an error, and the line is named", async ({ page }) => {
  await open(page);

  await setSource(page, app("Broken", "out = = `no`."));
  await page.locator("#run").click();

  await expect(page.locator("#status")).toContainText("error", { timeout: 30000 });
  await expect(page.locator("#output")).toBeVisible();
  expect(await outputText(page)).toMatch(/line \d+:/);

  // The previous app is still standing - a failed compile does not blank the
  // screen you were looking at.
  await expect(page.frameLocator("#app").getByText("Hello abap2UI5")).toBeVisible();
});

test("a class under the wrong name is explained rather than silently ignored", async ({ page }) => {
  await open(page);

  await setSource(page, app("Renamed", "out = `x`.").replace(/zcl_playground/g, "zcl_something_else"));
  await page.locator("#run").click();

  await expect(page.locator("#output")).toBeVisible({ timeout: 30000 });
  expect(await outputText(page)).toContain("zcl_playground.clas.abap");
  expect(await outputText(page)).toContain("ZCL_SOMETHING_ELSE");
});

test("an ABAP exception surfaces as the framework's own error page", async ({ page }) => {
  await open(page);

  await setSource(page, app("Raises", "RAISE EXCEPTION TYPE z2ui5_cx_ui5_util_error EXPORTING val = `deliberate`."));
  await page.locator("#run").click();

  // The framework turns an unhandled exception into a 500 whose body is the
  // dump, and the frontend shows it. That path has to work here exactly as it
  // does on a real system - it is how a developer debugs.
  await expect(page.frameLocator("#app").getByText(/deliberate/)).toBeVisible({ timeout: 60000 });
});

test("a second run replaces the class rather than keeping the first version", async ({ page }) => {
  await open(page);

  await setSource(page, app("First", "out = `one`."));
  await page.locator("#run").click();
  await expect(control(page, "txtOut")).toContainText("one", { timeout: 60000 });

  await setSource(page, app("Second", "out = `two`."));
  await page.locator("#run").click();
  await expect(control(page, "txtOut")).toContainText("two", { timeout: 60000 });
  await expect(page.frameLocator("#app").getByText("Second")).toBeVisible();
});

test("the output panel does not outlive the error it reported", async ({ page }) => {
  await open(page);

  await setSource(page, app("Broken", "out = = `no`."));
  await page.locator("#run").click();
  await expect(page.locator("#output")).toBeVisible();

  await setSource(page, app("Fixed", "out = `fixed`."));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.locator("#output")).toBeHidden();
  await expect(control(page, "txtOut")).toContainText("fixed");
});
