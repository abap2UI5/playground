import { test, expect } from "@playwright/test";
import { markers, open, setSource } from "./helpers.mjs";

// The editor half: Monaco with abaplint behind it, checking the class against
// the real abap2UI5 sources rather than against a grammar.

const CLEAN = `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
ENDCLASS.
CLASS zcl_playground IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    me->client = client.
    DATA(view) = z2ui5_cl_ui5_view_builder=>factory( ).
    client->view_display( view->stringify( ) ).
  ENDMETHOD.
ENDCLASS.`;

test("the editor shows the sample, highlighted as ABAP", async ({ page }) => {
  await open(page);

  const editor = page.locator(".monaco-editor");
  await expect(editor).toBeVisible();
  await expect(page.locator("#editor")).toContainText("CLASS zcl_playground DEFINITION");
  // Monaco colours ABAP keywords through its own grammar; a token span for the
  // keyword class is the observable part of that.
  await expect(page.locator(".monaco-editor .mtk5, .monaco-editor .mtk6").first()).toBeVisible();
});

test("a class that only uses the framework correctly reports nothing", async ({ page }) => {
  await open(page);
  await setSource(page, CLEAN);

  // Nothing here is resolvable without the abap2UI5 sources in the registry:
  // the interface, the client type, the view builder. Silence is the proof
  // that the corpus is loaded and linked.
  expect(await markers(page)).toEqual([]);
});

test("a syntax error is marked on its own line", async ({ page }) => {
  await open(page);
  await setSource(page, CLEAN.replace("me->client = client.", "me->client = = client."));

  const found = await markers(page);
  expect(found.length).toBeGreaterThan(0);
  expect(found[0].line).toBe(9);
});

test("a name the framework does not have is reported", async ({ page }) => {
  await open(page);
  await setSource(page, CLEAN.replace("z2ui5_cl_ui5_view_builder", "z2ui5_cl_does_not_exist"));

  const found = await markers(page);
  expect(found.map((m) => m.message).join("\n")).toMatch(/z2ui5_cl_does_not_exist/i);
});

test("a missing method implementation is reported", async ({ page }) => {
  await open(page);
  await setSource(
    page,
    `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
ENDCLASS.
CLASS zcl_playground IMPLEMENTATION.
ENDCLASS.`,
  );

  const found = await markers(page);
  expect(found.map((m) => m.message).join("\n")).toMatch(/main/i);
});

test("completion offers the framework's class names", async ({ page }) => {
  await open(page);
  await setSource(page, CLEAN);

  // Type a prefix where a class name belongs and ask for suggestions.
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("z2ui5_cl_ui5_view");
  await page.keyboard.press("Control+Space");

  const suggest = page.locator(".suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 10000 });
  await expect(suggest).toContainText("z2ui5_cl_ui5_view_builder");
});

test("hover explains a symbol from the framework", async ({ page }) => {
  await open(page);
  await setSource(page, CLEAN);

  // Hovering the client variable asks abaplint what it is, which it can only
  // answer from the parsed corpus.
  const target = page.getByText("z2ui5_if_client").first();
  await target.hover();
  await expect(page.locator(".monaco-hover").first()).toBeVisible({ timeout: 10000 });
});

test("the pretty printer reformats the class", async ({ page }) => {
  await open(page);
  await setSource(page, CLEAN.replace("  PUBLIC SECTION.", "PUBLIC SECTION.").replace("class zcl", "CLASS zcl"));

  // Through the editor action rather than its keyboard shortcut: what is being
  // tested is that abaplint's formatting provider is wired up, not that Monaco
  // still binds Shift+Alt+F.
  await page.evaluate(async () => {
    const editor = window.monaco.editor.getEditors()[0];
    await editor.getAction("editor.action.formatDocument").run();
  });
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
  expect(after, "abaplint's pretty printer indents the section again").toContain("  PUBLIC SECTION.");
});
