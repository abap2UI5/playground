import { test, expect } from "@playwright/test";
import { addNamedFile, MAIN_CLASS, MAIN_FILE, open, setSource } from "./helpers.mjs";
import { encodeFiles } from "../src/shell/share.mjs";

// The debugger (docs/design/debugger.md): breakpoints in the editor, the
// program stopped in the runtime worker, stepping, the stack and the
// variables in the panel's Debugger tab - src/shell/debugger.mjs,
// src/runtime/debug.mjs, src/editor/instrument.mjs.

const stopped = (page) => expect(page.locator("html")).toHaveAttribute("data-debugger", "stopped", { timeout: 30000 });
const running = (page) => expect(page.locator("html")).toHaveAttribute("data-debugger", "running", { timeout: 30000 });
const where = (page) => page.locator(".debug-where");
const variable = (page, name) =>
  page.locator(".debug-variables .state-row").filter({ has: page.locator(".state-name", { hasText: new RegExp(`^${name.replace(/[[\]<>]/g, "\\$&")}$`) }) });

// A breakpoint on a line, by the caret and F9 - what a keyboard does.
async function toggleBreakpoint(page, line, file = MAIN_FILE) {
  await page.evaluate(
    ([l, f]) => {
      const editor = window.monaco.editor.getEditors()[0];
      editor.setModel(window.monaco.editor.getModel(window.monaco.Uri.parse(`file:///${f}`)));
      editor.setPosition({ lineNumber: l, column: 1 });
      editor.revealLineInCenter(l);
      editor.focus();
    },
    [line, file],
  );
  await page.keyboard.press("F9");
}

// The app this file drives: a loop through a private method, a table, a
// BREAK-POINT, and a second event that changes an attribute.
const APP = `CLASS ${MAIN_CLASS} DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
    TYPES: BEGIN OF ty_item,
             id    TYPE i,
             label TYPE string,
           END OF ty_item.
    DATA total TYPE i.
    DATA items TYPE STANDARD TABLE OF ty_item WITH EMPTY KEY.
  PRIVATE SECTION.
    METHODS add IMPORTING iv TYPE i RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS ${MAIN_CLASS} IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    DATA lv_sum TYPE i.
    IF client->check_on_init( ).
      DO 3 TIMES.
        lv_sum = add( sy-index ).
        APPEND VALUE #( id = sy-index label = |item { sy-index }| ) TO items.
      ENDDO.
      BREAK-POINT.
      total = lv_sum.
      client->view_display( z2ui5_cl_ui5_view_builder=>factory(
          )->ele( n = \`View\` ns = \`mvc\`
              )->a( n = \`xmlns\`     v = \`sap.m\`
              )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\`
          )->ele( \`Page\`
              )->tag( \`Button\`
                  )->a( n = \`id\`    v = \`more\`
                  )->a( n = \`text\`  v = |Total { client->_bind( total ) }|
                  )->a( n = \`press\` v = client->_event( \`MORE\` )
          )->stringify( ) ).
    ELSEIF client->check_on_event( \`MORE\` ).
      total = add( 10 ).
      client->view_model_update( ).
    ENDIF.
  ENDMETHOD.

  METHOD add.
    total = total + iv.
    rv = total.
  ENDMETHOD.
ENDCLASS.
`;
// Lines of APP, counted from 1.
const L = {
  main: 15, sum: 16, doLoop: 18, call: 19, append: 20, enddo: 21, brk: 22, total: 23, more: 35, endmethod: 38,
  addFirst: 41, addReturn: 42, addEnd: 43,
};

test("BREAK-POINT stops the app start: the line, the locals, the stack; F6, F7 and F8 step and go on", async ({ page }) => {
  await open(page);
  await setSource(page, APP);
  await page.locator("#run").click();

  await stopped(page);
  await expect(page.locator('[data-insight="debug"]')).toHaveClass(/is-active/);
  await expect(where(page)).toContainText(`BREAK-POINT - line ${L.brk} of ${MAIN_FILE}`);
  await expect(page.locator("#status")).toContainText(`stopped at line ${L.brk}`);
  // The line is marked in the editor, and the editor takes no typing.
  await expect(page.locator(".debug-line")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.monaco.editor.getEditors()[0].getOption(window.monaco.editor.EditorOption.readOnly))).toBe(true);

  // Locals, me and the system fields.
  await expect(variable(page, "lv_sum").locator(".state-value")).toHaveText("6");
  await expect(variable(page, "client").locator(".state-type")).toContainText("importing");
  await expect(variable(page, "total").locator(".state-value")).toHaveText("6");
  await expect(variable(page, "items").locator(".state-value")).toContainText("3 rows");
  await expect(variable(page, "sy-subrc")).toHaveCount(1);
  // The stack: the app's main, with the framework under it.
  await expect(page.locator(".debug-stack li").first()).toContainText(`${MAIN_CLASS.toUpperCase()}->z2ui5_if_app~main`);

  // A table opens a level at a time.
  await variable(page, "items").locator(".state-toggle").click();
  await expect(variable(page, "[2]")).toHaveCount(1);
  await variable(page, "[2]").locator(".state-toggle").click();
  await expect(variable(page, "label").first().locator(".state-value")).toHaveText("item 2");

  // F6: the next statement, and the one after it.
  await page.keyboard.press("F6");
  await expect(where(page)).toContainText(`step - line ${L.total} of`);
  await page.keyboard.press("F6");
  await expect(where(page)).toContainText(`step - line ${L.total + 1} of`);
  await stopped(page);

  // The watchdog sleeps while stopped: a two-second limit, four seconds
  // looking at the stop, and the program is still there.
  await page.evaluate(() => { window.__abap2ui5RunLimit = 2000; });
  await page.waitForTimeout(4000);
  await expect(page.locator("html")).toHaveAttribute("data-debugger", "stopped");
  await page.evaluate(() => { window.__abap2ui5RunLimit = 30000; });

  // F8: on to the end; the app renders.
  await page.keyboard.press("F8");
  await running(page);
  const button = page.frameLocator("#app").locator('[id$="--more"]');
  await expect(button).toContainText("Total 6", { timeout: 30000 });
  await expect(page.locator(".debug-line")).toHaveCount(0);

  // A breakpoint in the private method, reached by a click in the app.
  await toggleBreakpoint(page, L.addFirst);
  await expect(page.locator(".bp-glyph")).toHaveCount(1);
  await button.click();
  await stopped(page);
  await expect(where(page)).toContainText(`breakpoint - line ${L.addFirst} of`);
  await expect(page.locator(".debug-stack li")).toHaveCount(3); // add, main, the framework
  await expect(page.locator(".debug-stack li").first()).toContainText("->add");
  await expect(variable(page, "iv").locator(".state-value")).toHaveText("10");
  await expect(variable(page, "iv").locator(".state-type")).toContainText("importing");

  // Another frame of the stack: main's locals, main's line.
  await page.locator(".debug-stack li").nth(1).locator("button").click();
  await expect(page.locator(".debug-variables .log-title")).toContainText("z2ui5_if_app~main");
  await expect(page.locator(".debug-frame-line")).toHaveCount(1);
  await page.locator(".debug-stack li").first().locator("button").click();
  await expect(page.locator(".debug-variables .log-title")).toContainText("->add");

  // F7: back in main, after the call.
  await page.keyboard.press("F7");
  await stopped(page);
  await expect(where(page)).toContainText(`step - line ${L.more + 1} of`);
  await expect(page.locator(".debug-stack li")).toHaveCount(2);
  await page.keyboard.press("F8");
  await running(page);
  await expect(button).toContainText("Total 16", { timeout: 30000 });
});

test("a value is changed while stopped, a condition decides, a watchpoint stops on a change", async ({ page }) => {
  await open(page);
  await setSource(page, APP.replace("      BREAK-POINT.\n", "      lv_sum = lv_sum.\n"));
  // On the call inside the loop, only when sy-index is 2.
  await toggleBreakpoint(page, L.call);
  await page.locator('[data-insight="debug"]').click();
  await page.locator(".debug-bp .debug-condition").fill("sy-index = 2");
  await page.locator(".debug-bp .debug-condition").press("Enter");
  await page.locator("#run").click();
  await stopped(page);
  await expect(where(page)).toContainText("breakpoint: sy-index = 2 is true");
  await expect(variable(page, "sy-index").locator(".state-value")).toHaveText("2");
  await expect(variable(page, "lv_sum").locator(".state-value")).toHaveText("1");

  // Double-click, type, Enter: the program goes on with the new value.
  await variable(page, "lv_sum").locator(".state-value").dblclick();
  await page.locator(".debug-edit").fill("100");
  await page.locator(".debug-edit").press("Enter");
  await expect(variable(page, "lv_sum").locator(".state-value")).toHaveText("100");

  // A watch, and a watchpoint on it: the next change stops.
  await page.locator(".debug-add input").fill("total");
  await page.locator(".debug-add input").press("Enter");
  await expect(page.locator(".debug-watch .state-value")).toHaveText("1");
  await page.locator(".debug-watch input[type=checkbox]").check();
  await page.locator(".debug-bp input[type=checkbox]").uncheck();
  await page.keyboard.press("F8");
  await stopped(page);
  await expect(where(page)).toContainText("watchpoint: total changed: 1 → 3");
  await expect(page.locator(".debug-stack li").first()).toContainText("->add");

  // A bad value is refused, and the variable keeps its own.
  await variable(page, "iv").locator(".state-value").dblclick();
  await page.locator(".debug-edit").fill("abc");
  await page.locator(".debug-edit").press("Enter");
  await expect(page.locator("#status")).toContainText('"abc" is not a value for iv');
  await expect(variable(page, "iv").locator(".state-value")).toHaveText("2");
});

test("Stop ends the program and starts the app again, held only for that start", async ({ page }) => {
  await open(page);
  await setSource(page, APP);
  await page.locator("#run").click();
  await stopped(page);
  await page.keyboard.press("Shift+F8");
  // The app is there again - its start ran through the BREAK-POINT that
  // stopped it, or Stop would stop again at once.
  const more = page.frameLocator("#app").locator('[id$="--more"]');
  await expect(more).toContainText("Total 6", { timeout: 60000 });
  await expect(page.locator("#status")).toContainText("the app started again");
  await expect(page.locator(".debug-line")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.monaco.editor.getEditors()[0].getOption(window.monaco.editor.EditorOption.readOnly))).toBe(false);

  // ...and only that start: the next click stops at a breakpoint as before.
  await toggleBreakpoint(page, L.more);
  await more.click();
  await stopped(page);
  await expect(where(page)).toContainText(`breakpoint - line ${L.more} of`);

  // Run while stopped: the stop ends, and the Run is the only start - the
  // app comes up once, from the code on screen.
  await toggleBreakpoint(page, L.more);
  await setSource(page, APP.replace("      BREAK-POINT.\n", ""));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(more).toContainText("Total 6", { timeout: 30000 });
});

test("a Pause with nothing running says it waits, and can be taken back", async ({ page }) => {
  await open(page);
  await setSource(page, APP.replace("      BREAK-POINT.\n", ""));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await page.locator('[data-insight="debug"]').click();
  await page.locator(".debug-bar button", { hasText: "Pause" }).click();
  await expect(where(page)).toContainText("Pause is waiting");
  await expect(page.locator(".debug-bar button", { hasText: "Pause" })).toBeDisabled();
  await where(page).locator("button", { hasText: "Cancel" }).click();
  await expect(where(page)).toHaveCount(0);
  // Taken back: a click in the app runs through.
  const more = page.frameLocator("#app").locator('[id$="--more"]');
  await more.click();
  await expect(more).toContainText("Total 16", { timeout: 30000 });
  await expect(page.locator("html")).not.toHaveAttribute("data-debugger", "stopped");

  // Not taken back: the next click stops at its first statement.
  await page.locator(".debug-bar button", { hasText: "Pause" }).click();
  await more.click();
  await stopped(page);
  await expect(where(page)).toContainText("paused");
  await page.keyboard.press("F8");
  await expect(more).toContainText("Total 26", { timeout: 30000 });
});

test("a breakpoint in a CATCH block stops there, as on any other statement", async ({ page }) => {
  await open(page);
  const catching = APP.replace("      total = add( 10 ).\n", "      TRY.\n          total = 1 / 0.\n        CATCH cx_sy_zerodivide.\n          total = add( 10 ).\n      ENDTRY.\n");
  await setSource(page, catching);
  const lines = catching.split("\n");
  const inCatch = lines.findIndex((l) => l.includes("total = add( 10 ).")) + 1;
  await toggleBreakpoint(page, inCatch);
  await page.locator("#run").click();
  await stopped(page); // the BREAK-POINT of the app start
  // Verified, on the line it was set on - not hollow and not moved. At
  // @abaplint/transpiler 2.14.15 the body of a CATCH had no line to stop at.
  await page.evaluate((l) => window.monaco.editor.getEditors()[0].revealLineInCenter(l), inCatch);
  await expect(page.locator(".bp-glyph.is-unverified")).toHaveCount(0);
  await expect(page.locator(".debug-bp")).not.toHaveClass(/is-unverified/);
  await expect(page.locator(".debug-bp .debug-link")).toHaveText(new RegExp(`:${inCatch}$`));
  await page.keyboard.press("F8");
  await running(page);

  // The division by zero is caught, and the handler is where it stops.
  const more = page.frameLocator("#app").locator('[id$="--more"]');
  await more.click();
  await stopped(page);
  await expect(where(page)).toContainText(`breakpoint - line ${inCatch} of`);
  await page.keyboard.press("F8");
  await expect(more).toContainText("Total 16", { timeout: 30000 });
});

test("a breakpoint on a line with no statement moves to the next one, and is kept for the next visit", async ({ page }) => {
  await open(page);
  // Line 24 of the sample is empty, 25 is `me->client = client.`
  await toggleBreakpoint(page, 24);
  await page.locator("#run").click();
  await stopped(page);
  await expect(where(page)).toContainText(`breakpoint - line 25 of ${MAIN_FILE}`);
  await page.keyboard.press("F8");
  await running(page);

  // Kept over a reload, and the app's first roundtrip stops at it again.
  await page.reload();
  await stopped(page);
  await expect(where(page)).toContainText("line 25 of");
  await expect(page.locator(".bp-glyph")).toHaveCount(1);
  await page.keyboard.press("F8");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });

  // A click in the glyph margin takes it away.
  await page.evaluate(() => {
    const editor = window.monaco.editor.getEditors()[0];
    editor.revealLine(25);
  });
  await page.locator(".bp-glyph").click();
  await expect(page.locator(".bp-glyph")).toHaveCount(0);
});

test("Pause stops a loop that is running, and Stop ends it", async ({ page }) => {
  await open(page);
  await setSource(page, APP.replace("      BREAK-POINT.\n", "      DATA(n) = 0.\n      WHILE n = 0.\n        lv_sum = lv_sum + 1.\n      ENDWHILE.\n"));
  await page.locator("#run").click();
  await page.locator('[data-insight="debug"]').click();
  await page.waitForTimeout(1000);
  await page.locator(".debug-bar button", { hasText: "Pause" }).click();
  await stopped(page);
  await expect(where(page)).toContainText("paused");
  const sum = Number(await variable(page, "lv_sum").locator(".state-value").textContent());
  expect(sum).toBeGreaterThan(100);
  // Stop, without a restart of the loop for this test: a Run is pressed at
  // once with code that ends.
  await setSource(page, APP.replace("      BREAK-POINT.\n", ""));
  await page.locator("#run").click();
  await expect(page.frameLocator("#app").locator('[id$="--more"]')).toContainText("Total 6", { timeout: 60000 });
});

test("a breakpoint in a unit test stops while the tests run", async ({ page }) => {
  await open(page);
  const cls = `CLASS ${MAIN_CLASS} DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
    METHODS double IMPORTING iv TYPE i RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS ${MAIN_CLASS} IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
  ENDMETHOD.

  METHOD double.
    rv = iv * 2.
  ENDMETHOD.
ENDCLASS.
`;
  const testFile = `${MAIN_CLASS}.clas.testclasses.abap`;
  const tests = `CLASS ltcl_test DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS doubles FOR TESTING.
ENDCLASS.

CLASS ltcl_test IMPLEMENTATION.
  METHOD doubles.
    DATA(cut) = NEW ${MAIN_CLASS}( ).
    DATA(result) = cut->double( 21 ).
    cl_abap_unit_assert=>assert_equals( act = result exp = 42 ).
  ENDMETHOD.
ENDCLASS.
`;
  await setSource(page, cls);
  await addNamedFile(page, testFile);
  await setSource(page, tests, testFile);
  await toggleBreakpoint(page, 12, MAIN_FILE); // rv = iv * 2.
  await toggleBreakpoint(page, 9, testFile); // DATA(result) = cut->double( 21 ).
  await page.locator("#run").click();
  await stopped(page);
  await expect(where(page)).toContainText(`line 9 of ${testFile}`);
  await expect(page.locator(".debug-stack li").first()).toContainText("LTCL_TEST->doubles");
  // F5 goes into the class under test.
  await page.keyboard.press("F5");
  await stopped(page);
  await expect(where(page)).toContainText(`line 12 of ${MAIN_FILE}`);
  await expect(variable(page, "iv").locator(".state-value")).toHaveText("21");
  await expect(page.locator(".debug-stack li")).toHaveCount(3);
  await page.keyboard.press("F8");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.locator("#test-count")).toHaveText("✓");
});

test("an app-only page and a plain embed do not stop at BREAK-POINT and show no debugger", async ({ page }) => {
  const fragment = await encodeFiles([{ name: MAIN_FILE, source: APP }]);
  for (const query of ["?view=app", "?embed=1"]) {
    await page.goto(`/${query}#${fragment}`);
    await expect(page.frameLocator("#app").locator('[id$="--more"]')).toContainText("Total 6", { timeout: 90000 });
    await expect(page.locator('[data-insight="debug"]')).toBeHidden();
  }
});

test("an embed that asks for it (?debug=1) has the debugger, and keeps no breakpoints", async ({ page }) => {
  const fragment = await encodeFiles([{ name: MAIN_FILE, source: APP }]);
  await page.goto(`/?embed=1&debug=1#${fragment}`);
  await stopped(page);
  await expect(page.locator('[data-insight="debug"]')).toBeVisible();
  await expect(where(page)).toContainText(`BREAK-POINT - line ${L.brk} of`);
  await toggleBreakpoint(page, L.more);
  await page.keyboard.press("F8");
  await page.frameLocator("#app").locator('[id$="--more"]').click();
  await stopped(page);
  await expect(where(page)).toContainText(`breakpoint - line ${L.more} of`);
  // An embed never writes the stored settings - its breakpoints included.
  expect(await page.evaluate(() => localStorage.getItem("abap2ui5-playground:breakpoints"))).toBeNull();
});

test("the table view, the hover, run to the cursor and a stop at RAISE EXCEPTION", async ({ page }) => {
  await open(page);
  // The MORE event raises, caught by the app itself.
  const raising = APP.replace("      total = add( 10 ).\n", "      TRY.\n          RAISE EXCEPTION TYPE cx_sy_zerodivide.\n        CATCH cx_sy_zerodivide.\n          total = add( 10 ).\n      ENDTRY.\n");
  await setSource(page, raising);
  await page.locator("#run").click();
  await stopped(page);

  // The rows as a grid, one column per component.
  await variable(page, "items").locator(".debug-button", { hasText: "table" }).click();
  const grid = page.locator(".debug-table-dialog");
  await expect(grid.locator("th")).toHaveText(["#", "id", "label"]);
  await expect(grid.locator("tr").nth(3).locator("td")).toHaveText(["3", "3", "item 3"]);
  await grid.locator(".debug-button", { hasText: "Close" }).click();
  await expect(grid).toHaveCount(0);

  // The value under the mouse.
  await page.evaluate((line) => window.monaco.editor.getEditors()[0].revealLineInCenter(line), L.total);
  await page.locator(".view-line", { hasText: "total = lv_sum." }).getByText("lv_sum").hover();
  const hover = page.locator(".monaco-hover").filter({ hasText: "lv_sum" }).first();
  await expect(hover).toContainText("lv_sum = 6 - i");

  // Run to the cursor: the caret on ENDMETHOD (four lines further down in
  // this version of the app).
  await page.evaluate((line) => {
    const editor = window.monaco.editor.getEditors()[0];
    editor.setPosition({ lineNumber: line, column: 1 });
  }, L.endmethod + 4);
  await page.locator(".debug-bar button", { hasText: "To cursor" }).click();
  await stopped(page);
  await expect(where(page)).toContainText(`step - line ${L.endmethod + 4} of`);
  await page.keyboard.press("F8");
  await running(page);

  // Stop at RAISE EXCEPTION, then the click that raises. (The tab is still
  // in front - a click on it now would fold the panel away.)
  await page.locator(".debug-option input").first().check();
  await page.frameLocator("#app").locator('[id$="--more"]').click();
  await stopped(page);
  await expect(where(page)).toContainText("RAISE EXCEPTION");
  await page.keyboard.press("F8");
  await expect(page.frameLocator("#app").locator('[id$="--more"]')).toContainText("Total 16", { timeout: 30000 });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a tap sets a breakpoint, and a stop brings the code forward rather than the app", async ({ page }) => {
    await open(page);
    // A tap in the glyph margin next to line 25 of the sample.
    const at = await page.evaluate(() => {
      const editor = window.monaco.editor.getEditors()[0];
      editor.revealLineInCenter(25);
      const layout = editor.getLayoutInfo();
      const box = editor.getDomNode().getBoundingClientRect();
      return { x: box.left + layout.glyphMarginLeft + 5, y: box.top + editor.getTopForLineNumber(25) - editor.getScrollTop() + 8 };
    });
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.locator(".bp-glyph")).toHaveCount(1);
    await page.locator("#run").click();
    await stopped(page);
    await expect(page.locator('.tab[data-pane="left"]')).toHaveClass(/is-active/);
    await expect(page.locator("#pane-left")).toBeVisible();
    await expect(page.locator(".debug-bar button", { hasText: "Continue" })).toBeVisible();
    await page.locator(".debug-bar button", { hasText: "Continue" }).click();
    await running(page);
  });
});
