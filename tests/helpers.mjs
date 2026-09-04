import { expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// What the page carries, as the build worked it out.
//
// The samples are abap2UI5/samples' own now - src/editor/sample-list.mjs names
// the classes, writeSamples( ) in tools/build-site.mjs resolves them against
// the pinned repository - so nothing about them is written twice. A test that
// needs a sample's files or its title reads them from what was built rather
// than repeating them, which is what keeps moving the pin from being a sweep
// through the suite.
export const SAMPLES = readSamples();

function readSamples() {
  try {
    return JSON.parse(readFileSync(new URL("../build/samples/index.json", import.meta.url), "utf8"));
  } catch {
    // The one thing a test cannot work around, said plainly: everything here
    // runs against a built dist/, and this file is part of that build.
    throw new Error("build/samples/index.json is not there - run `npm run build` before the tests.");
  }
}
export const sampleFiles = (id) => SAMPLES.find((s) => s.id === id).files;

// The file the playground opens on, and the class inside it. A test that hands
// the playground ABAP of its own has to declare the class its file is named
// after: the playground refuses the pair when they disagree, exactly as a
// system does.
export const MAIN_FILE = SAMPLES[0].files[0];
export const MAIN_CLASS = MAIN_FILE.replace(/\.clas\.abap$/, "");

// A phrase that is both IN the app the page opens on and ON the screen once it
// has run: every sample in that repository titles its Page after itself. One
// string does both jobs a test needs - replace it in the source to make a
// version of your own, and look for it in the frame to see that a version ran.
export const MAIN_MARK = SAMPLES[0].title;

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
export async function setSource(page, source, file = MAIN_FILE) {
  await page.evaluate(
    ([s, f]) => window.monaco.editor.getModel(window.monaco.Uri.parse(`file:///${f}`)).setValue(s),
    [source, file],
  );
  await page.waitForTimeout(400);
}

export async function getSource(page, file = MAIN_FILE) {
  return page.evaluate(
    (f) => window.monaco.editor.getModel(window.monaco.Uri.parse(`file:///${f}`))?.getValue(),
    file,
  );
}

// The open files, in the order the playground holds them - which is the order
// the strip shows and, for the first one, what Run starts. Read off the strip
// rather than out of Monaco: Monaco's own model list is in creation order,
// which is not the same thing once a file has been reopened.
// Puts the caret in the ABAP editor.
//
// Not a click on `.view-lines`, which is what this used to be: Monaco sizes
// that element to the WIDEST line in the file, so on a class with a long
// string concatenation in it the element is wider than the pane it sits in -
// and its centre, which is where a click lands, is over the app frame beside
// the editor. The pane is the thing that is always where it looks.
export async function clickEditor(page) {
  await page.locator("#editor").click();
}

export async function openFiles(page) {
  return page.locator(".file-tab [data-file]").evaluateAll((tabs) => tabs.map((t) => t.dataset.file));
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
