import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SITE } from "../tools/sample-pages.mjs";

// dist/404.html - what GitHub Pages serves for any address it cannot find
// under this deployment.
//
// WHY IT EXISTS: samples get renamed and dropped by the three repositories
// they come from, and the next deploy removes their pages here; every link to
// one of them, in an issue, a blog post or somebody's bookmarks, then lands on
// an address that is not a page. Before this that was GitHub's own white page
// - no bar, no search, no way on. So the properties worth holding are: the
// frame is there, the links out are there, and the page GUESSES, because a
// reader who mistyped a class has already named what they wanted.
//
// The one page here that links ABSOLUTELY: it is served at /samples/<typo>/
// and at /<typo> alike, so a relative href would resolve against whichever
// address missed. tools/serve.mjs therefore mounts the tree under SITE's own
// path as well, which is where those links point.

const BASE = new URL(SITE).pathname;
const DIST = path.join(process.cwd(), "dist");
const index = JSON.parse(fs.readFileSync(path.join(DIST, "samples", "apps.json"), "utf8"));
const paged = index.entries.filter((e) => e.page);

/* An address shaped like one of this deployment's own, with the last character
 * of a real class name missing: the commonest way to arrive at a page that is
 * not there, and the case the name matcher exists for. */
const nearMiss = () => {
  const real = paged.find((e) => /_\d+\/$/.test(e.page)).page.replace(/\/$/, "");
  return { missed: `${BASE}samples/${real.slice(0, -1)}/`, wanted: `${BASE}samples/${real}/` };
};

test("an address that is not a page answers 404 with this site's own page", async ({ page }) => {
  const response = await page.goto(nearMiss().missed);
  expect(response.status()).toBe(404);

  // The status is what a crawler goes by; the head says the same, for a proxy
  // or a preview that rewrites it.
  const html = await response.text();
  expect(html).toContain('<meta name="robots" content="noindex">');

  await expect(page.locator("h1")).toHaveText("This page is not here");
  // The frame: the four sections and the box, the same bar as every other page.
  await expect(page.locator(".bar-nav a")).toHaveCount(4);
  await expect(page.locator(".search-slot")).toBeVisible();
  // ...and the bar does not claim this is the samples page.
  await expect(page.locator('.bar-nav a[aria-current="page"]')).toHaveCount(0);
});

test("the way on is in the page, and every link on it works from any depth", async ({ page }) => {
  // Two directories deeper than the deployment root, which is where a relative
  // href would go wrong.
  await page.goto(`${BASE}samples/no_such_class/at_all/`);
  const hrefs = await page.locator("main a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThan(3);
  for (const href of hrefs) {
    if (/^https?:/.test(href)) continue;
    expect(href, "a link on the 404 is absolute, or it points at whatever missed").toMatch(/^\//);
  }
  // The catalogue, followed rather than asserted: the point is that it lands.
  await page.getByRole("link", { name: "catalog", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}samples/`);
  await expect(page.locator("h1")).toBeVisible();
});

test("a class name one character short suggests the classes it almost named", async ({ page }) => {
  const { missed, wanted } = nearMiss();
  await page.goto(missed);
  await expect(page.locator("#near")).toBeVisible();

  const hrefs = await page.locator("#near li a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  // Every suggestion is a page that is actually there...
  for (const href of hrefs) {
    expect(fs.existsSync(path.join(DIST, href.slice(BASE.length), "index.html")), `${href} exists`).toBe(true);
  }
  // ...and the class the address was one character short of is among them.
  expect(hrefs).toContain(wanted);
});

test("a word in the address finds the samples whose titles carry it", async ({ page }) => {
  // A word this catalogue certainly has, taken from the index rather than
  // named here: the three repositories decide what is in it.
  const entry = paged.find((e) => /^[A-Za-z]{6,}$/.test(String(e.title).split(" ")[0]));
  const word = String(entry.title).split(" ")[0].toLowerCase();

  await page.goto(`${BASE}samples/z2ui5_cl_smpc_app_${word}/`);
  await expect(page.locator("#near")).toBeVisible();
  const titles = await page.locator("#near li a").allTextContents();
  expect(titles.some((t) => t.toLowerCase().includes(word))).toBe(true);
});

test("an address with nothing close to it offers nothing", async ({ page }) => {
  await page.goto(`${BASE}zzz-nothing-like-this-here/`);
  await expect(page.locator("h1")).toHaveText("This page is not here");
  await expect(page.locator("#near")).toBeHidden();
});
