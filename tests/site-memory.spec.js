import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Where you were, on each of the two sites the bar moves between.
//
// The playground, the sample catalogue and the documentation are three
// deployments on one origin, so they share a localStorage: each page writes
// down where it is, and the nav item pointing at the other site is lifted to
// whatever that site wrote last. What is held here:
//
//   THE ROUND TRIP. Catalogue, narrowed to a search -> playground -> the
//   Samples item comes back to the NARROWED list, not to the front of it. The
//   filters are the page over there, which is why the URL they live in is what
//   gets remembered.
//   A SAMPLE'S OWN PAGE COUNTS AS THE SAMPLES. Reading one and going to the
//   playground puts that page behind the Samples item.
//   A STORED VALUE IS CHECKED, NOT FOLLOWED. Anything on this origin can write
//   to that key. Four values that resolve outside the link the markup carries
//   are each ignored in favour of the link the markup carries.
//   THE MARKUP IS THE FALLBACK. Everything above only ever UPGRADES an href
//   that already works, which is what a crawler and a reader with no
//   JavaScript get.
//
// The documentation half cannot be exercised here: it is served from another
// host in this suite, so every path through it takes the different-origin
// branch. That branch IS tested below, and the same-origin cases are pinned by
// a unit test in abap2UI5/docs (test/site-memory.test.mjs) where `location` is
// a stub.

const SAMPLES_KEY = "abap2ui5-playground:last-samples";
const DOCS_KEY = "abap2ui5-playground:last-docs";

const DIST = path.join(process.cwd(), "dist");
const index = JSON.parse(fs.readFileSync(path.join(DIST, "samples", "apps.json"), "utf8"));
const firstPage = index.entries.find((e) => e.page).page;

const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

/** The playground's bar, which consults both sites and is remembered by neither. */
async function openPlayground(page) {
  await page.goto("/");
  await expect(page.locator(".bar-nav")).toBeVisible();
}

const samplesLink = (page) => page.locator('.bar-nav a[data-site="samples"]');
/* The Documentation item, which is the one the docs key lifts. It is written
   at the first page of the manual and restores anywhere inside /docs/ - the
   `data-scope` attribute on it is what separates those two (site-memory.mjs).
   Home is a link to the front page and is never lifted. */
const docsLink = (page) => page.locator('.bar-nav a[data-site="docs"]');
const DOCS_HREF = "https://abap2ui5.github.io/docs/get_started/about";

test("the catalogue writes down the page it is on, filters and all", async ({ page }) => {
  await page.goto("/samples/?q=table");
  await expect(page.locator("#count")).toContainText("sample");

  expect(await stored(page, SAMPLES_KEY)).toBe("/samples/?q=table");
});

test("a filter typed on the page moves what is remembered with it", async ({ page }) => {
  await page.goto("/samples/");
  await expect(page.locator("#count")).toContainText("sample");
  expect(await stored(page, SAMPLES_KEY)).toBe("/samples/");

  await page.locator("#q").fill("wizard");
  await expect.poll(() => stored(page, SAMPLES_KEY)).toBe("/samples/?q=wizard");
});

test("a sample's own page is where you were in the samples", async ({ page }) => {
  await page.goto(`/samples/${firstPage}`);
  expect(await stored(page, SAMPLES_KEY)).toBe(`/samples/${firstPage}`);
});

test("the playground's Samples item comes back to the narrowed list", async ({ page }) => {
  await page.goto("/samples/?q=table&lib=sap.m");
  await expect(page.locator("#count")).toContainText("sample");

  await openPlayground(page);
  // The href the markup carries is `samples/`; what is on it now is the list
  // that was left, which is the whole point of the round trip.
  await expect(samplesLink(page)).toHaveAttribute("href", "/samples/?q=table&lib=sap.m");
});

test("and to the sample that was being read", async ({ page }) => {
  await page.goto(`/samples/${firstPage}`);

  await openPlayground(page);
  await expect(samplesLink(page)).toHaveAttribute("href", `/samples/${firstPage}`);
});

test("with nothing stored the item is the link the markup carries", async ({ page }) => {
  await openPlayground(page);
  await expect(samplesLink(page)).toHaveAttribute("href", "samples/");
});

// A poisoned or stale value must cost the reader a restored position and
// nothing else. Each of these resolves outside `samples/`, and each one leaves
// the markup's own href in place.
for (const [what, value] of [
  ["another host", "//example.invalid/x"],
  ["a path that normalises out of the section", "/samples/../../evil"],
  ["a path outside the section", "/embed/example.html"],
  ["a javascript: url", "javascript:alert(1)"],
  ["something that is not a url at all", "%%%"],
]) {
  test(`a stored value naming ${what} is ignored`, async ({ page }) => {
    await page.goto("/samples/");
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SAMPLES_KEY, value]);

    await openPlayground(page);
    await expect(samplesLink(page)).toHaveAttribute("href", "samples/");
  });
}

test("a site on another origin shares no storage, so its item is left alone", async ({ page }) => {
  await page.goto("/samples/");
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [DOCS_KEY, "/docs/cookbook/view/definition.html"]);

  await openPlayground(page);
  // The documentation is abap2ui5.github.io in a test run served from
  // localhost, which is exactly the case the origin check exists for.
  await expect(docsLink(page)).toHaveAttribute("href", DOCS_HREF);
});

test("the playground itself is consulted and never remembered", async ({ page }) => {
  await page.goto("/samples/");
  await openPlayground(page);

  // Its URL carries the code in the editor, and an item that reopened
  // yesterday's sample would be a different promise from the one the word
  // makes. Nothing under the two keys names the playground.
  expect(await stored(page, SAMPLES_KEY)).toBe("/samples/");
  expect(await stored(page, DOCS_KEY)).toBe(null);
});

test("a sample page carries the same two lines the bundles import", async ({ page }) => {
  await page.goto(`/samples/${firstPage}`);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [DOCS_KEY, "//example.invalid/x"]);
  await page.reload();

  // The per-sample pages have no bundle - the memory is an inline copy there
  // (tools/sample-pages.mjs), so it is checked on its own: it writes, and it
  // refuses the same values.
  expect(await stored(page, SAMPLES_KEY)).toBe(`/samples/${firstPage}`);
  await expect(docsLink(page)).toHaveAttribute("href", DOCS_HREF);
});
