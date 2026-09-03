import { test, expect } from "@playwright/test";
import { addNamedFile, control, markers, open, outputText, setSource } from "./helpers.mjs";

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
    IF client->check_on_init( ).
      ${body}
      view_display( ).
      RETURN.
    ENDIF.
    IF client->check_on_navigated( ).
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

test("what the transpiler refuses is underlined at its line, until the text changes", async ({ page }) => {
  await open(page);

  // abaplint's curated rules say nothing about the order of WHEN branches;
  // the transpiler's validation insists on WHEN OTHERS being last. So this
  // passes the editor and fails Run - with a file and a row in the message.
  const wrong = app(
    "Refused",
    `CASE out.
      WHEN OTHERS.
        out = \`other\`.
      WHEN \`a\`.
        out = \`a\`.
      ENDCASE.`,
  );
  await setSource(page, wrong);
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("the app could not be started", { timeout: 60000 });

  // Underlined where it is, and in the Problems list - which the run opened,
  // because a line is where somebody looks. The Log still has the full text.
  await expect.poll(async () => (await markers(page)).filter((m) => m.message.includes("(transpiler)")).length).toBe(1);
  await expect(page.locator("#insight-body .insight-row", { hasText: /transpiler|WHEN OTHERS/i })).toBeVisible();
  await page.locator('[data-insight="log"]').click();
  await expect(page.locator(".log-body")).toContainText("when_others_last");

  // Gone the moment the text changes - the next Run says what is still true.
  await setSource(page, wrong.replace("WHEN OTHERS.\n        out = `other`.\n      ", "") + "\n");
  await expect.poll(async () => (await markers(page)).filter((m) => m.message.includes("(transpiler)")).length).toBe(0);
});

test("a declaration below the first statement is not an error", async ({ page }) => {
  await open(page);

  // `definitions_top` used to be on the abaplint rule list, inherited from the
  // configuration abap2UI5 lints ITSELF with - where it is there because the
  // framework is downported to 702 before it is transpiled. Nothing here
  // downports, so it was rejecting ABAP that compiles on every system: a
  // FIELD-SYMBOLS after a CREATE DATA, which is how the documentation's S-RTTI
  // example is written. An abaplint error stops Run, so the reader was told to
  // fix code that had nothing wrong with it.
  await setSource(
    page,
    app(
      "Declared late",
      `out = \`declared\`.
      DATA suffix TYPE string.
      suffix = \` below the first statement\`.
      out = |{ out }{ suffix }|.`,
    ),
  );
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });

  await expect(control(page, "txtOut")).toContainText("declared below the first statement");
});

test("a run is refused while the ABAP has an error, and the line is named", async ({ page }) => {
  await open(page);

  await setSource(page, app("Broken", "out = = `no`."));
  await page.locator("#run").click();

  await expect(page.locator("#status")).toContainText("error", { timeout: 30000 });
  // The errors live in the panel's problems list, one row each - not copied
  // into the log, which would be the same list twice in one panel.
  await expect(page.locator('[data-insight="problems"]')).toHaveClass(/is-active/);
  await expect(page.locator(".insight-row.is-error").first()).toBeVisible();
  await expect(page.locator(".insight-row.is-error").first()).toContainText("line");

  // The previous app is still standing - a failed compile does not blank the
  // screen you were looking at.
  await expect(page.frameLocator("#app").getByText("Hello abap2UI5")).toBeVisible();
});

test("a class under the wrong name is explained rather than silently ignored", async ({ page }) => {
  await open(page);

  await setSource(page, app("Renamed", "out = `x`.").replace(/zcl_playground/g, "zcl_something_else"));
  await page.locator("#run").click();

  await expect(page.locator(".log-body")).toBeVisible({ timeout: 30000 });
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

test("the reported errors do not outlive the run that reported them", async ({ page }) => {
  await open(page);

  await setSource(page, app("Broken", "out = = `no`."));
  await page.locator("#run").click();
  await expect(page.locator(".insight-row.is-error").first()).toBeVisible();

  await setSource(page, app("Fixed", "out = `fixed`."));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.locator(".insight-row.is-error")).toHaveCount(0);
  await expect(control(page, "txtOut")).toContainText("fixed");
});

// Inheritance is the one thing the chunks cannot resolve at call time: `class
// zcl_child extends zcl_base` names its superclass at definition time, in a
// scope of its own. These two would have been ReferenceErrors before the
// prologue in transpile.mjs - and the first one also proves the definition
// order, because the file that has to be defined first is not the first file.
test("a class can inherit from another file in the editor", async ({ page }) => {
  await open(page);

  await addNamedFile(page, "zcl_pg_base.clas.abap");
  await setSource(
    page,
    `CLASS zcl_pg_base DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS made_by RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_pg_base IMPLEMENTATION.
  METHOD made_by. rv = |the base class|. ENDMETHOD.
ENDCLASS.`,
    "zcl_pg_base.clas.abap",
  );

  await setSource(
    page,
    `CLASS zcl_playground DEFINITION PUBLIC INHERITING FROM zcl_pg_base CREATE PUBLIC.
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
    IF client->check_on_init( ).
      out = |written by { made_by( ) }|.
      view_display( ).
    ENDIF.
  ENDMETHOD.
  METHOD view_display.
    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`     v = \`sap.m\`
            )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).
    view->ele( \`Page\`
        )->a( n = \`title\` v = \`Inheritance\`
        )->tag( \`Text\`
            )->a( n = \`id\`   v = \`txtOut\`
            )->a( n = \`text\` v = client->_bind( out ) ).
    client->view_display( view->stringify( ) ).
  ENDMETHOD.
ENDCLASS.`,
  );

  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(control(page, "txtOut")).toContainText("written by the base class");
});

test("a class can inherit from the framework - a custom exception works", async ({ page }) => {
  await open(page);

  await addNamedFile(page, "zcx_pg_oops.clas.abap");
  await setSource(
    page,
    `CLASS zcx_pg_oops DEFINITION PUBLIC INHERITING FROM cx_static_check CREATE PUBLIC.
ENDCLASS.
CLASS zcx_pg_oops IMPLEMENTATION.
ENDCLASS.`,
    "zcx_pg_oops.clas.abap",
  );

  await setSource(
    page,
    app(
      "Exceptions",
      `TRY.
          RAISE EXCEPTION TYPE zcx_pg_oops.
        CATCH zcx_pg_oops.
          out = |caught the subclass|.
      ENDTRY.`,
    ),
  );

  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(control(page, "txtOut")).toContainText("caught the subclass");
});

test("a dump is pointed at: the ABAP line it was raised at, underlined, listed and under the cursor", async ({ page }) => {
  await open(page);

  // A division by zero inside the event - a runtime error, not one either
  // checker or the transpiler could see. The framework answers the frontend
  // with a dump, and the playground traces the dump's JavaScript stack back
  // through the transpiler's line table to the ABAP line.
  const source = app("Dumps", "DATA(zero) = 0.\n      out = |{ 1 / zero }|.");
  await setSource(page, source);
  const line = source.split("\n").findIndex((l) => l.includes("1 / zero")) + 1;
  await page.locator("#run").click();

  await expect(page.locator("#status")).toHaveText(`the app dumped - zcl_playground.clas.abap line ${line}`, { timeout: 60000 });
  // Listed as a runtime problem, at that line, naming the exception.
  const row = page.locator(".insight-row.is-error");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(`line ${line}`);
  await expect(row).toContainText("CX_SY_ZERODIVIDE");
  await expect(row).toContainText("runtime");
  // Underlined in the editor, and the cursor is on the line.
  const found = await markers(page);
  expect(found.some((m) => m.line === line && /zero/i.test(m.message) && /runtime/.test(m.message))).toBe(true);
  expect(await page.evaluate(() => window.monaco.editor.getEditors()[0].getPosition().lineNumber)).toBe(line);
  // The frame still shows the framework's own error page, as on a system.
  await expect(page.frameLocator("#app").getByText(/Division by zero/)).toBeVisible();

  // Fixed, the pointer goes with the next run.
  await setSource(page, app("Fixed", "out = `fixed`."));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.locator(".insight-row.is-error")).toHaveCount(0);
});
