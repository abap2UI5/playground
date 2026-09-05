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
const PLAYGROUND_KEY = "abap2ui5-playground:last-playground";

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

test("the playground writes itself down too, URL and all", async ({ page }) => {
  // It used to be consulted and never remembered, on the grounds that its URL
  // carries the code in the editor rather than a place. What that missed is
  // the case it creates: a reader with a SAMPLE open here has code that is not
  // a draft and is not stored as one, so pressing Documentation and then
  // Playground threw it away and started them on the default sample. The URL
  // is what carries it, so the URL is what is written down.
  await page.goto("/samples/");
  await openPlayground(page);

  expect(await stored(page, SAMPLES_KEY)).toBe("/samples/");
  expect(await stored(page, DOCS_KEY)).toBe(null);
  /* `openPlayground` goes to "/", which is the URL a reader arrives on. */
  expect(await stored(page, PLAYGROUND_KEY)).toBe("/");
});

test("a sample opened in the playground is what the item comes back to", async ({ page }) => {
  const src = "https://raw.githubusercontent.com/abap2UI5/samples/main/x.clas.abap";
  await page.goto(`/index.html?src=${encodeURIComponent(src)}`);
  await expect(page.locator(".bar-nav")).toBeVisible();
  await expect.poll(() => stored(page, PLAYGROUND_KEY)).toContain("src=");
});

test("an embedded playground is furniture in somebody else's page, and writes nothing", async ({ page }) => {
  await page.goto("/index.html?embed=1");
  await page.waitForTimeout(1500);
  expect(await stored(page, PLAYGROUND_KEY)).toBe(null);
});

test("an app-only view is a running app, not a place to come back to", async ({ page }) => {
  await page.goto("/index.html?view=app");
  await page.waitForTimeout(1500);
  expect(await stored(page, PLAYGROUND_KEY)).toBe(null);
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

// ---------------------------------------------------------------------------
// WHERE ON THE PAGE, which is the other half of coming back to it.
//
// The item above restored the catalogue and put the reader at row 1 of it. The
// offset is written per path now, and restored on arrival BY THE BAR and
// nowhere else - a bar link writes one record saying where it is sending the
// reader, and the page that is that, arriving within half a minute, honours
// it. This is the round trip a browser is needed for: a real scroll, a real
// navigation, and a real scroll position on the other side.

const SCROLL_KEY = "abap2ui5-playground:scroll";
const BACK_KEY = "abap2ui5-playground:returning";

test("the catalogue comes back to the row the reader was on, not to the top", async ({ page }) => {
  await page.goto("/samples/");
  await expect(page.locator("#count")).toContainText("sample");
  await page.evaluate(() => scrollTo(0, 2400));
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(2000);

  // Out through the bar. Every item that leaves this page writes down how far
  // down it the reader was, whatever it then does with the href. The
  // navigation itself is stopped after the fact: the destination is a host
  // that does not exist in a test run, and what would be on screen instead is
  // an error page with no localStorage to read. A capture listener added HERE
  // runs after the one site-memory.mjs registered at boot - same target, same
  // phase, so registration order decides - which is what makes this the
  // click's own handler running and only the browser's part of it refused.
  await page.evaluate(() => document.addEventListener("click", (e) => e.preventDefault(), true));
  await page.locator(".bar-nav a[data-back]").first().click();
  expect(JSON.parse(await stored(page, SCROLL_KEY))["/samples/"]).toBeGreaterThan(2000);

  // ...and the record that sends them back, which in life is written by the
  // documentation's bar pressing Samples. It cannot be written from here: in a
  // test run the documentation is another host, so that item takes the
  // different-origin branch and writes nothing - the same limit the header of
  // this file describes. What IS this repository's to hold is the other end:
  // the page arrives, sees a record naming it, and puts the reader back.
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ to: "/samples/", at: Date.now() })), BACK_KEY);

  await page.goto("/samples/");
  await expect(page.locator("#count")).toContainText("sample");
  // Polled, because 770 rows arrive from a fetch: at the moment the page asks,
  // the document is a header and too short to hold the offset at all. That is
  // the case restoring has to survive, and the reason it is re-applied rather
  // than done once.
  await expect.poll(
    () => page.evaluate(() => Math.round(scrollY)),
    { message: "the list is where it was left" },
  ).toBeGreaterThan(2000);
});

test("an ordinary arrival is left at the top, because nobody said otherwise", async ({ page }) => {
  // The record is what makes a restore happen. Without one - a link followed
  // from anywhere else, a bookmark, a reload - the page opens where a page
  // opens. Restoring here would drop a reader into the middle of a list with
  // nothing on screen to explain it, and would fight the browser's own back
  // and forward, which already do this properly.
  await page.goto("/samples/");
  await expect(page.locator("#count")).toContainText("sample");
  await page.evaluate(() => scrollTo(0, 2400));
  await page.evaluate((k) => localStorage.removeItem(k), BACK_KEY);

  await page.goto("/samples/");
  await expect(page.locator("#count")).toContainText("sample");
  expect(await page.evaluate(() => Math.round(scrollY))).toBe(0);
});

test("a record naming another page is not this page's journey", async ({ page }) => {
  await page.goto("/samples/");
  await expect(page.locator("#count")).toContainText("sample");
  await page.evaluate(([s, b]) => {
    localStorage.setItem(s, JSON.stringify({ "/samples/": 2400 }));
    localStorage.setItem(b, JSON.stringify({ to: "/samples/z2ui5_cl_smp_app_001/", at: Date.now() }));
  }, [SCROLL_KEY, BACK_KEY]);

  await page.goto("/samples/");
  await expect(page.locator("#count")).toContainText("sample");
  expect(await page.evaluate(() => Math.round(scrollY))).toBe(0);
});

test("what the bar stores is an offset, and anything else is ignored", async ({ page }) => {
  // The key is on an origin four deployments share; scrollTo takes whatever it
  // is given. None of these is an offset.
  for (const junk of ['{"/samples/":"9e99"}', '{"/samples/":-500}', "[1,2]", "not json"]) {
    await page.goto("/samples/");
    await expect(page.locator("#count")).toContainText("sample");
    await page.evaluate(([s, b, j]) => {
      localStorage.setItem(s, j);
      localStorage.setItem(b, JSON.stringify({ to: "/samples/", at: Date.now() }));
    }, [SCROLL_KEY, BACK_KEY, junk]);

    await page.goto("/samples/");
    await expect(page.locator("#count")).toContainText("sample");
    expect(await page.evaluate(() => Math.round(scrollY)), junk).toBe(0);
  }
});

// ---------------------------------------------------------------------------
// THE LAST THING YOU SEARCHED FOR.

const QUERY_KEY = "abap2ui5-playground:search";

/* The index is ONE document, published by the documentation on the origin all
   four bars share (/docs/search-index.json) - which in a test run is another
   host and not there. Two entries are enough for what is being held here: that
   a hit writes the query down and the next box starts with it. */
const INDEX = {
  built: "2026-09-05",
  entries: [
    { area: "samples", url: "https://abap2ui5.github.io/playground/samples/z2ui5_cl_smp_app_001/", title: "Table with a growing list", code: "z2ui5_cl_smp_app_001", text: "sap.m.Table" },
    { area: "docs", url: "https://abap2ui5.github.io/docs/cookbook/tables", title: "Tables", text: "Binding a table" },
  ],
};

const withIndex = async (page) => {
  /* The hit's own destination is a real page on the published site. Nothing
     here is about what is at the other end - only that opening a hit writes
     the query down - and a test that reaches the live internet is a test that
     fails when the network does.

     FIRST, because the index below is on that host too and Playwright matches
     routes in reverse order of registration: the narrower one has to be the
     later one, or this catch-all answers the index request with a page. It
     did, and the box then found nothing to open. */
  await page.route("https://abap2ui5.github.io/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>somewhere else</title>" }));
  await page.route("**/docs/search-index.json", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(INDEX) }));
};

test("the search box opens with the query the last hit was opened on", async ({ page }) => {
  await withIndex(page);
  await page.goto("/samples/");
  await expect(page.locator("#count")).toContainText("sample");

  await page.locator(".search-button").click();
  const field = page.locator(".search-panel input");
  await field.fill("table");
  await expect(page.locator(".search-hit").first()).toBeVisible();
  await page.locator(".search-hit").first().click();

  // A hit was opened, so the query was written down - and the next box on this
  // origin starts with it, selected, so a reader with a different question
  // types over it rather than reaching for Backspace.
  await page.goto("/samples/");
  await expect(page.locator("#count")).toContainText("sample");
  await page.locator(".search-button").click();
  await expect(page.locator(".search-panel input")).toHaveValue("table");
  expect(await page.evaluate(() => [
    document.querySelector(".search-panel input").selectionStart,
    document.querySelector(".search-panel input").selectionEnd,
  ])).toEqual([0, 5]);
});

test("a box closed without opening anything remembers nothing new", async ({ page }) => {
  await withIndex(page);
  await page.goto("/samples/");
  await expect(page.locator("#count")).toContainText("sample");
  await page.evaluate((k) => localStorage.removeItem(k), QUERY_KEY);

  await page.locator(".search-button").click();
  await page.locator(".search-panel input").fill("carousel");
  await page.keyboard.press("Escape");
  await expect(page.locator(".search-scrim")).toBeHidden();

  expect(await stored(page, QUERY_KEY)).toBe(null);
});
