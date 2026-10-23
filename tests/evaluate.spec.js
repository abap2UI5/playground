import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SITE } from "../tools/sample-pages.mjs";
import { factsIn } from "../src/evaluate/lib/facts.mjs";

// dist/evaluate/ - the page for the person who approves abap2UI5
// (tools/evaluate-page.mjs). It lived in the manual at /docs/evaluate; it is a
// page of this deployment now, so a link a developer sends to the person who
// decides does not say "manual". What is worth holding: the frame and the
// hero are there, the eight sections keep the ids the redirect over there and
// the framework's README link to, the figures are read and never typed, the
// links out of it work, and a phone does not slide sideways under it.

const BASE = new URL(SITE).pathname;
const DIST = path.join(process.cwd(), "dist");
const URL_ = `${BASE}evaluate/`;

test("the page is the catalogue's frame around the hero, the sections and the tiles", async ({ page }) => {
  const response = await page.goto(URL_);
  expect(response.status()).toBe(200);
  await expect(page).toHaveTitle(/^Evaluate abap2UI5/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}evaluate/`);
  await expect(page.locator("h1")).toHaveText("Evaluate abap2UI5");
  // the bar, with no section of its own marked: the page is none of the five
  await expect(page.locator(".bar-nav > *")).toHaveText(["Home", "Documentation", "Samples", "Playground", "AI Studio"]);
  await expect(page.locator('.bar-nav [aria-current="page"]')).toHaveCount(0);
  await expect(page.locator(".hero-action.primary")).toHaveAttribute("href", BASE);
  await expect(page.locator(".tiles .tile")).toHaveCount(4);
  // the screenshot is this deployment's own file, not the manual's
  const shot = page.locator(".hero-shot img");
  await expect(shot).toHaveAttribute("src", `${BASE}evaluate/walkthrough-preview.webp`);
  expect(await shot.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test("the sections keep the ids the links from the manual and the framework name", async ({ page }) => {
  await page.goto(URL_);
  const ids = await page.locator(".band > h2").evaluateAll((hs) => hs.map((h) => h.id));
  expect(ids).toEqual([
    "the-problem-it-answers", "when-to-use-it-and-when-not", "what-you-keep", "where-it-runs",
    "what-it-costs", "the-objections", "who-runs-it", "how-to-evaluate-it-in-a-week",
  ]);
  await expect(page.locator(".band table")).toHaveCount(2);
});

test("the figures under the hero are the framework README's, never typed here", async ({ page }) => {
  const readme = path.join(process.cwd(), "deps", "abap2ui5", "README.md");
  test.skip(!fs.existsSync(readme), "no framework checkout in deps/");
  const facts = factsIn(fs.readFileSync(readme, "utf8"));
  await page.goto(URL_);
  if (!facts.length) {
    await expect(page.locator(".facts-line")).toHaveCount(0);
    return;
  }
  await expect(page.locator(".facts-line")).toHaveText(facts.join(" · "));
  // the workflow count is a maintainer's figure, the release span the tagline's
  await expect(page.locator(".facts-line")).not.toContainText("workflows");
  expect(factsIn("<!-- facts:start --><sub>3 ABAP unit tests · 2 workflows · ABAP 7.02 → Cloud — counted from this repository by npm run facts</sub><!-- facts:end -->"))
    .toEqual(["3 ABAP unit tests"]);
});

test("every link of this deployment on it answers, and the manual's are absolute", async ({ page }) => {
  await page.goto(URL_);
  const hrefs = await page.locator("main a[href], .foot a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  for (const href of new Set(hrefs)) {
    if (href.startsWith("#")) continue;
    // a relative link into /docs/ would resolve under /playground/ and miss
    expect(href, `${href} names the manual relatively`).not.toMatch(/^\/(?!playground\/)|^\.\.?\//);
    if (/^https?:/.test(href)) continue;
    const res = await page.request.get(href);
    expect(res.status(), href).toBe(200);
  }
});

test("nothing on it pushes the page sideways on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(URL_);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  // ...and the hero is only as tall as it is: no basis turned into a height
  const gap = await page.evaluate(() => document.querySelector(".hero-shot").getBoundingClientRect().top
    - document.querySelector(".hero-note").getBoundingClientRect().bottom);
  expect(gap).toBeLessThan(60);
});

test("it is in the sitemap", async () => {
  expect(fs.readFileSync(path.join(DIST, "sitemap.xml"), "utf8")).toContain(`<loc>${SITE}evaluate/</loc>`);
});
