import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { MAIN_FILE, openFiles, pickSample } from "./helpers.mjs";

// Guided first steps (src/shell/guides.mjs): the hint strip a first visit
// gets over the editor, and the lesson bar while the app is one of
// abap2UI5/samples' "Start here".
//
// Every other spec starts with the strip closed (storageState in
// playwright.config.js); this one starts as a stranger would.
test.use({ storageState: { cookies: [], origins: [] } });

const KEY = "abap2ui5-playground:first-steps";
const PATH = JSON.parse(readFileSync(new URL("../build/samples/lessons.json", import.meta.url), "utf8"));
const LESSONS = PATH.lessons;
const strip = (page) => page.locator("#first-steps");
const lesson = (page) => page.locator(".lesson-label");
const step = (page, which) => page.locator(`#first-steps button[data-step="${which}"]`);

async function boot(page, url = "/") {
  await page.goto(url);
  await expect(page.locator("#status")).toHaveText(/^running/, { timeout: 120000 });
}

// The strip and the bar are chunks asked for after the first run, so "not
// there" is only an answer once they have had the time to arrive.
async function settle(page) {
  await page.waitForTimeout(1500);
}

test("a first visit gets the strip; closing it is remembered across a reload", async ({ page }) => {
  await boot(page);
  await expect(strip(page)).toBeVisible();
  await expect(strip(page)).toHaveAttribute("aria-label", "First steps");
  // innerText: each label is there twice, long and short, and the strip
  // shows the one the editor has the width for.
  await expect(strip(page).locator("button[data-step]")).toHaveText([
    /Change the code and press Run|Edit, then Run/,
    "Turn on Auto",
    /Edit the view/,
    /Browse .* samples/,
  ], { useInnerText: true });

  // Over the editor, not in its way: the editor is the same box with the
  // strip there and once it has gone.
  const before = await page.locator("#editor").boundingBox();
  const box = await strip(page).boundingBox();
  expect(box.y).toBeGreaterThan(before.y);
  expect(box.y + box.height).toBeLessThanOrEqual(before.y + before.height);
  // One line at desk width.
  expect(box.height).toBeLessThan(48);

  await page.getByRole("button", { name: "Close the first steps" }).click();
  await expect(strip(page)).toHaveCount(0);
  expect(await page.locator("#editor").boundingBox()).toEqual(before);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).not.toBeNull();

  await page.reload();
  await expect(page.locator("#status")).toHaveText(/^running/, { timeout: 120000 });
  await expect(lesson(page)).toBeVisible();
  await settle(page);
  await expect(strip(page)).toHaveCount(0);
});

test("Escape closes the strip, and its buttons do what they say", async ({ page }) => {
  await boot(page);
  await step(page, "auto").click();
  await expect(page.locator("#autorun")).toHaveAttribute("aria-checked", "true");
  // Pressed again it does not turn Auto back off.
  await step(page, "auto").click();
  await expect(page.locator("#autorun")).toHaveAttribute("aria-checked", "true");

  await step(page, "view").click();
  await expect(page.locator('.insight-tab[data-insight="view"]')).toHaveAttribute("aria-selected", "true");

  await step(page, "samples").click();
  await expect(page.locator("#examples-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#examples-dialog")).toBeHidden();

  // The caret goes into the code, and Run is pointed at.
  await step(page, "run").click();
  await expect(page.locator("#run")).toHaveClass(/is-pointed/);
  expect(await page.evaluate(() => document.getElementById("editor").contains(document.activeElement))).toBe(true);

  await step(page, "run").focus();
  await page.keyboard.press("Escape");
  await expect(strip(page)).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).not.toBeNull();
});

test("on a phone the strip is one small line over the editor", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await boot(page);
  await expect(strip(page)).toBeVisible();
  const box = await strip(page).boundingBox();
  expect(box.height).toBeLessThan(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await context.close();
});

for (const [what, url] of [
  ["an embedded playground", "/?embed=1"],
  ["?view=app", "/?view=app"],
  ["a ?src= link", "/?src=examples/zcl_linked_example.clas.abap"],
  ["a row of the catalogue", "/?from=catalogue"],
]) {
  test(`no strip in ${what}`, async ({ page }) => {
    await boot(page, url);
    await settle(page);
    await expect(strip(page)).toHaveCount(0);
  });
}

test("no lesson bar in an embedded playground", async ({ page }) => {
  await boot(page, "/?embed=1");
  await settle(page);
  await expect(page.locator(".lesson")).toHaveCount(0);
});

// The lessons the page does not carry come from abap2UI5/samples over ?src=,
// served here from the pinned copy the build used.
async function serveSamplesRepo(page) {
  await page.route("https://raw.githubusercontent.com/abap2UI5/samples/**", (route) => {
    const file = new URL(`../deps/abap2ui5-samples/src/${route.request().url().split("/").pop()}`, import.meta.url);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "", headers: { "access-control-allow-origin": "*" } });
    return route.fulfill({
      status: 200,
      contentType: "text/plain",
      headers: { "access-control-allow-origin": "*" },
      body: readFileSync(file, "utf8"),
    });
  });
}

test("the lesson bar steps through Start here and follows the app", async ({ page }) => {
  // What this test walks: the page opens on Basics II, the path's second.
  expect(LESSONS[1].class).toBe(MAIN_FILE.replace(/\.clas\.abap$/, ""));
  const n = LESSONS.length;
  await serveSamplesRepo(page);
  await boot(page);
  await page.getByRole("button", { name: "Close the first steps" }).click();

  await expect(lesson(page)).toHaveText(`Lesson 2 of ${n}`);
  const editor = await page.locator("#editor").boundingBox();

  await page.getByRole("button", { name: `Previous lesson: ${LESSONS[0].title}` }).click();
  await expect(lesson(page)).toHaveText(`Lesson 1 of ${n}`);
  expect((await openFiles(page))[0]).toBe(`${LESSONS[0].class}.clas.abap`);
  await expect(page.getByRole("button", { name: "No previous lesson" })).toBeDisabled();
  await expect(page.locator("#status")).toHaveText(/^running/, { timeout: 60000 });

  await page.getByRole("button", { name: `Next lesson: ${LESSONS[1].title}` }).click();
  await expect(lesson(page)).toHaveText(`Lesson 2 of ${n}`);
  expect((await openFiles(page))[0]).toBe(MAIN_FILE);

  // A lesson opened from the samples browser is the same lesson.
  await pickSample(page, "roundtrips");
  await expect(lesson(page)).toHaveText(`Lesson 4 of ${n}`);
  await expect(page.locator("#status")).toHaveText(/^running/, { timeout: 60000 });

  // Basics V is not carried: it opens over ?src=, the way the samples
  // browser opens a catalogued row, and runs.
  await page.getByRole("button", { name: `Next lesson: ${LESSONS[4].title}` }).click();
  await expect(lesson(page)).toHaveText(`Lesson 5 of ${n}`, { timeout: 60000 });
  expect((await openFiles(page))[0]).toBe(`${LESSONS[4].class}.clas.abap`);
  await expect(page.locator("#status")).toHaveText(/^running/, { timeout: 60000 });

  // The bar never moved the editor.
  expect(await page.locator("#editor").boundingBox()).toEqual(editor);

  // An app off the path and the bar is gone.
  await pickSample(page, "table");
  await expect(page.locator(".lesson")).toBeHidden();
});
