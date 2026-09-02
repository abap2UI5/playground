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

// Picks a built-in sample in the samples browser and waits for the dialog to
// close - and for nothing else, because a sample that starts broken on
// purpose never reaches "running" (see tests/samples.spec.js).
export async function pickSample(page, id) {
  await page.locator("#examples").click();
  await page.locator(`.example-row[data-sample="${id}"]`).click();
  await expect(page.locator("#examples-dialog")).toBeHidden();
}

// Adds a file: press "+", type the name into the strip, press Enter.
//
// This was a window.prompt( ) driven with page.once("dialog", ...) until it
// turned out that a cross-origin iframe - which is what an embedded playground
// is - never shows one, so the button did nothing there.
export async function addNamedFile(page, name) {
  await page.locator(".file-add").click();
  await page.locator(".file-new").fill(name);
  await page.locator(".file-new").press("Enter");
  await expect(page.locator(".file-tab", { hasText: name })).toBeVisible();
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

export const outputText = (page) => page.locator(".log-body").textContent();

// Picks a built-in sample in the examples browser - the one way to one, now
// that there is no sample menu - and waits for the app that came out of it.
//
// Waiting on the status line alone is a race: it still says "running" from the
// previous app while the new one compiles, so an assertion can pass against the
// app that is about to be replaced. The frame's src carries a counter that goes
// up once per run, which is unambiguous.
export async function runSample(page, id) {
  const before = await page.locator("#app").getAttribute("src");
  await pickSample(page, id);
  await expect(page.locator("#app")).not.toHaveAttribute("src", before ?? "", { timeout: 60000 });
  // "running", or "running - your draft is one Undo away" when the sample
  // went in over somebody's own work.
  await expect(page.locator("#status")).toHaveText(/^running/, { timeout: 60000 });
}
