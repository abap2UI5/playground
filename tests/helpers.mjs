import { expect } from "@playwright/test";

// Opens the playground and waits until it has compiled and started the class in
// the editor. Everything downstream depends on that, so every test starts here.
export async function open(page) {
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
}

// UI5 prefixes every control id with the id of the view that holds it
// (`mainView--btnGreet`), so the tests match on the suffix - the part the ABAP
// actually chose.
export const control = (page, id, suffix = "") =>
  page.frameLocator("#app").locator(`[id$="--${id}${suffix}"]`);

// Replaces what is in the editor. The editor reacts to a change on a short
// debounce, so this waits out that delay rather than leaving every caller to
// remember it.
export async function setSource(page, source) {
  await page.evaluate((s) => window.monaco.editor.getModels()[0].setValue(s), source);
  await page.waitForTimeout(400);
}

export async function getSource(page) {
  return page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
}

// The problems abaplint is reporting on the current source, as Monaco shows
// them in the gutter.
export async function markers(page) {
  return page.evaluate(() =>
    window.monaco.editor.getModelMarkers({}).map((m) => ({
      line: m.startLineNumber,
      message: m.message,
      severity: m.severity,
    })),
  );
}

export async function run(page) {
  await page.locator("#run").click();
}

export const outputText = (page) => page.locator("#output-body").textContent();
