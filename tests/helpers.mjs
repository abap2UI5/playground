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
export async function setSource(page, source, file = "zcl_playground.clas.abap") {
  await page.evaluate(
    ([s, f]) => window.monaco.editor.getModel(window.monaco.Uri.parse(`file:///${f}`)).setValue(s),
    [source, file],
  );
  await page.waitForTimeout(400);
}

export async function getSource(page, file = "zcl_playground.clas.abap") {
  return page.evaluate(
    (f) => window.monaco.editor.getModel(window.monaco.Uri.parse(`file:///${f}`))?.getValue(),
    file,
  );
}

export async function openFiles(page) {
  return page.evaluate(() =>
    window.monaco.editor
      .getModels()
      .filter((m) => m.uri.scheme === "file")
      .map((m) => m.uri.path.replace(/^\//, "")),
  );
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

// Picks a sample and waits for the app that came out of it.
//
// Waiting on the status line alone is a race: it still says "running" from the
// previous app while the new one compiles, so an assertion can pass against the
// app that is about to be replaced. The frame's src carries a counter that goes
// up once per run, which is unambiguous.
export async function runSample(page, id) {
  const before = await page.locator("#app").getAttribute("src");
  await page.locator("#samples").selectOption(id);
  await expect(page.locator("#app")).not.toHaveAttribute("src", before ?? "", { timeout: 60000 });
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
}
