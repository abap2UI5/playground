import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// One static page per sample, at samples/<class>/ - written by
// tools/sample-pages.mjs from the index the build just produced.
//
// WHY THEY EXIST: the catalogue is one URL with 770 samples drawn into it by
// JavaScript, so there is no address for "the abap2UI5 port of sap.m.Wizard"
// and nothing for a search engine to return. These pages are that address.
// Which means the properties worth holding are not the catalogue's: the text
// has to be IN the HTML, the links have to be real links, and every page has
// to be reachable from a page that is itself reachable.
//
// Unlike tests/catalogue.spec.js these run against the REAL index - the pages
// are built from it, so a fixture would be testing a page that was never
// written. They therefore assert shapes and invariants over whatever the three
// repositories currently hold, never a particular sample's wording.

const CORS = { "access-control-allow-origin": "*" };
const DIST = path.join(process.cwd(), "dist");
const index = JSON.parse(fs.readFileSync(path.join(DIST, "samples", "apps.json"), "utf8"));
const paged = index.entries.filter((e) => e.page);
const controlName = (i) => index.controls[i];

test("a sample's page carries what the catalogue knows, in the HTML itself", async ({ page }) => {
  // A port that runs here and builds something - the case the catalogue is
  // for, and the one whose page has every part.
  const entry = paged.find((e) => e.runs && (e.controls || []).length > 1 && e.summary);
  expect(entry, "the index has a runnable sample with controls").toBeTruthy();

  const response = await page.request.get(`/samples/${entry.page}`);
  expect(response.status()).toBe(200);
  const html = await response.text();

  // Everything below is asserted on the RAW response: no bundle, no fetch, no
  // rendering step. That is the whole point of these pages - a crawler that
  // runs no JavaScript still gets the sample.
  expect(html).not.toContain("catalogue.mjs");
  expect(html).toContain(`<h1>${entry.title}</h1>`);
  expect(html).toContain(entry.class.toUpperCase());
  expect(html).toContain(entry.summary.slice(0, 40));

  // What a search engine is handed: a title, a description, and the one
  // canonical address for this sample.
  expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/);
  expect(html).toContain(
    `<link rel="canonical" href="https://abap2ui5.github.io/playground/samples/${entry.page}">`,
  );
  expect(html).toContain('<script type="application/ld+json">');

  // The controls the LINTER found in the builder chain - the answer no other
  // listing of these samples has, and the reason a page like this is worth
  // indexing rather than being 770 copies of a title.
  for (const i of entry.controls) expect(html).toContain(controlName(i));

  // The three ways out: run it here, read the ABAP, back to the search.
  expect(html).toContain(`href="../../?src=${encodeURIComponent(entry.raw)}`);
  expect(html).toContain(`back=${encodeURIComponent(`q=${entry.class}`)}`);
  expect(html).toContain(entry.github);
  expect(html).toContain('<a href="../">Sample catalogue</a>');
});

test("a sample page prints the class itself, coloured and escaped", async ({ page }) => {
  // The class IS the sample, so it is on the page rather than one click away
  // on GitHub - fetched at build time (tools/sample-sources.mjs) and coloured
  // there too (tools/abap-highlight.mjs), because these pages run no
  // JavaScript. A reader who wanted to know how it does what it does has the
  // answer in front of them, and a search for a call nobody wrote a sentence
  // about has something to match.
  const entry = paged.find((e) => e.runs && e.source === "learn") || paged.find((e) => e.runs);
  expect(entry, "the index has a sample that runs here").toBeTruthy();
  const html = await (await page.request.get(`/samples/${entry.page}`)).text();

  expect(html).toContain("<h2>The ABAP</h2>");
  expect(html).toContain(entry.raw.split("/").pop());
  const block = html.slice(html.indexOf('<pre class="source-body">'));
  expect(block).toContain("<code>");
  // Coloured: the statement words carry a class, and it is the one the
  // playground's own panel prints XML and JSON with.
  expect(block).toMatch(/<span class="code-key">(CLASS|class)<\/span>/);
  expect(block).toContain("ENDCLASS");

  // Escaped, all of it. This is somebody else's committed file printed into
  // this site's markup: the one thing that must never happen is a repository
  // deciding what is a tag here. `->` is in every abap2UI5 class there is.
  const code = block.slice(block.indexOf("<code>") + 6, block.indexOf("</code>"));
  expect(code).toContain("-&gt;");
  expect(code.replace(/<\/?span[^>]*>/g, "")).not.toMatch(/<[a-zA-Z/]/);
});

test("the pages carry the ABAP, not just the sample that was looked at", async () => {
  // A fetch that quietly returned nothing would leave 770 pages that still
  // build, still link and still describe - and no longer show the thing they
  // are about. So the set is counted, not sampled.
  const printed = paged.filter((entry) =>
    fs.readFileSync(path.join(DIST, "samples", entry.page, "index.html"), "utf8")
      .includes("<h2>The ABAP</h2>"),
  );
  expect(printed.length).toBeGreaterThan(paged.length * 0.9);
});

test("Run on a sample page opens it in the playground, and the playground offers the way back", async ({ page }) => {
  // The round trip that used to start on a card in the catalogue starts here
  // now: the card is a link to this page, and this page is where Run is.
  const entry = paged.find((e) => e.runs && e.source === "learn") || paged.find((e) => e.runs);
  expect(entry, "the index has a sample that runs here").toBeTruthy();
  await page.route(`**/${entry.raw.split("/").pop()}`, (route) =>
    route.fulfill({
      status: 200, contentType: "text/plain", headers: CORS,
      body: `CLASS ${entry.class} DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES z2ui5_if_app.\nENDCLASS.\n`
        + `CLASS ${entry.class} IMPLEMENTATION.\n  METHOD z2ui5_if_app~main.\n  ENDMETHOD.\nENDCLASS.\n`,
    }),
  );
  await page.goto(`/samples/${entry.page}`);
  await page.locator("a.run").click();

  const back = page.locator("#source-link");
  await expect(back).toHaveText("Back to the catalogue", { timeout: 120000 });
  // Narrowed to the class the reader came from, which is the search that has
  // exactly one hit - a static page cannot know the search they had.
  await expect(back).toHaveAttribute("href", `samples/?q=${entry.class}`);
  await expect(back).not.toHaveAttribute("target", "_blank");
});

test("a sample that cannot run here says what it needs, and offers no Run", async ({ page }) => {
  const entry = paged.find((e) => !e.runs && e.needs);
  expect(entry, "the index has a sample that does not run here").toBeTruthy();

  const html = await (await page.request.get(`/samples/${entry.page}`)).text();
  expect(html).toContain(entry.needs);
  // Listed, explained, and still linked to its source - a sample somebody
  // cannot find is worse than one they cannot run.
  expect(html).not.toContain('class="run"');
  expect(html).toContain(entry.github);
});

test("every sample has a page, and every page is in the sitemap", async () => {
  // The pages are generated, so the thing worth holding is that the set is
  // complete and that nothing points at a page that was not written.
  expect(paged.length).toBe(index.entries.length);

  const sitemap = fs.readFileSync(path.join(DIST, "sitemap.xml"), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs.length).toBe(paged.length + 3);
  expect(locs).toContain("https://abap2ui5.github.io/playground/");
  expect(locs).toContain("https://abap2ui5.github.io/playground/samples/");
  expect(locs).toContain("https://abap2ui5.github.io/playground/samples/all/");

  // Every URL in it is a page that exists. A sitemap naming a 404 is worse
  // than no sitemap: it is the one thing a crawler reads as carelessness.
  for (const loc of locs) {
    const rel = loc.replace("https://abap2ui5.github.io/playground/", "");
    expect(fs.existsSync(path.join(DIST, rel, "index.html")), `${loc} exists`).toBe(true);
  }
});

test("the pages are reachable without JavaScript: catalogue → the full list → each sample", async ({ page }) => {
  // A page in a sitemap and in no link is a page a crawler may ignore. The
  // catalogue's own document is JavaScript-rendered below the fold, so the
  // crawl path has to be in its static half - the footer - and lead to a list
  // that names every sample.
  const catalogue = await (await page.request.get("/samples/")).text();
  expect(catalogue).toContain('href="all/"');

  const all = await (await page.request.get("/samples/all/")).text();
  for (const entry of paged) expect(all).toContain(`href="../${entry.page}"`);
  expect(all).toContain('<h1>Every abap2UI5 sample</h1>');
});

test("a page renders as the catalogue's own, and its links work", async ({ page }) => {
  const entry = paged.find((e) => e.runs && (e.controls || []).length > 0);
  await page.goto(`/samples/${entry.page}`);

  await expect(page.locator("h1")).toHaveText(entry.title);
  // The bar is the catalogue's, so the stylesheet beside it is loading.
  await expect(page.locator(".bar-nav a", { hasText: "Samples" })).toBeVisible();
  // And it ends where the playground's own bar ends: LinkedIn, then GitHub.
  await expect(page.locator(".bar .social")).toHaveCount(2);
  await expect(page.locator('.bar .social[href*="linkedin.com"]')).toBeVisible();
  await expect(page.locator('.bar .social[href*="github.com"]')).toBeVisible();
  expect(await page.locator(".bar").evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("1px");

  // Back to the catalogue, and on to a neighbour: the internal links are what
  // make the set a site rather than 770 orphans.
  await page.locator(".crumbs a", { hasText: "Sample catalogue" }).click();
  await expect(page).toHaveURL(/\/samples\/$/);
});

test("the catalogue's cards link to the pages", async ({ page }) => {
  // The row a reader found the sample in is the shortest way to its page, and
  // the strongest internal link it gets. `page` is stamped on the entry by the
  // writer, so the card links to what was actually written.
  const entry = paged[0];
  await page.route("**/samples/apps.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...index,
        entries: [entry],
      }),
    }),
  );
  await page.goto("/samples/");
  const link = page.locator(".card h3 a");
  await expect(link).toHaveText(entry.title);
  await expect(link).toHaveAttribute("href", entry.page);
});
