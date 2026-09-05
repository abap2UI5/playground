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
// The one thing on a page that is not static is the demo box above the class:
// the embed loader mounts a playground in the page when a reader presses it,
// and never before. That is also where Run went - the page used to open with a
// row of buttons, and the links that were in it are facts in the facts now.
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

/* The first page that prints a class of at least this many lines, with the
 * page itself - the line-link tests need a class long enough to pick a passage
 * out of, and which sample that is depends on what the three repositories
 * currently hold. */
const printed = (least) =>
  paged
    .map((entry) => ({ entry, html: fs.readFileSync(path.join(DIST, "samples", entry.page, "index.html"), "utf8") }))
    .find(({ html }) => (html.match(/<span class="ln" id="L/g) || []).length >= least) || {};

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

  // The ways out: the sample running in this page, the whole playground on it,
  // the class on GitHub, back to the search. The first two are the demo box,
  // the third is a fact in the facts, and none of them is a button above the
  // page any more.
  expect(html).toContain(`<div class="abap2ui5-demo" data-src="${entry.raw}"`);
  expect(html).toContain('<script src="../../embed/abap2ui5-embed.js" defer></script>');
  expect(html).toContain(`href="../../?src=${encodeURIComponent(entry.raw)}`);
  expect(html).toContain(`back=${encodeURIComponent(`q=${entry.class}`)}`);
  expect(html).toContain(entry.github);
  expect(html).toContain('<a href="../">Sample catalogue</a>');
  expect(html).not.toContain('<div class="actions">');
});

test("a port's facts carry SAP's own sample, running in SAP's own demo kit", async ({ page }) => {
  // "What did the original do" is the first question a port raises, and the
  // demo kit answers it the way this page does - the sample on screen, not the
  // directory the sample was committed in. The demo kit files a sample under
  // the ENTITY it belongs to, which is not derivable from the sample id, so
  // the link carries both facts and this asserts the shape rather than a
  // particular port.
  const entry = paged.find((e) => e.sample && e.entity && e.runs);
  expect(entry, "the index has a port of a demo kit sample that runs here").toBeTruthy();

  const html = await (await page.request.get(`/samples/${entry.page}`)).text();
  // The whole row, so a regression to the folder it replaced - a listing of
  // view, controller and data, which is the question answered the long way
  // round - fails here rather than passing on the words around it.
  expect(html).toContain(
    `<dt>SAP's own sample</dt><dd><a href="`
    + `https://sdk.openui5.org/entity/${entry.entity}/sample/${entry.sample}"`,
  );

  // And the class itself is a fact too, not a button: the file, in the
  // repository the row came from.
  expect(html).toContain("<dt>Source file</dt>");
  expect(html).toContain(`<code>${entry.raw.split("/").pop()}</code> ↗</a>`);
});

test("the demo box mounts a playground in the page, and not before it is pressed", async ({ page }) => {
  // A second playground, booted inside this one's page: the frame does the
  // whole thing - the runtime, the registry, the app - so this one is given
  // room beyond the file's default.
  test.setTimeout(300000);
  // A playground is a whole ABAP runtime plus an abaplint parse of nine
  // hundred sources. 770 pages that booted one on sight would be 770 pages
  // nobody waits for, so the box is a button until somebody presses it - the
  // rule the embed loader holds for every page that uses it.
  const entry = paged.find((e) => e.runs && e.source === "learn") || paged.find((e) => e.runs);
  await page.route(`**/${entry.raw.split("/").pop()}`, (route) =>
    route.fulfill({
      status: 200, contentType: "text/plain", headers: CORS,
      body: `CLASS ${entry.class} DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES z2ui5_if_app.\nENDCLASS.\n`
        + `CLASS ${entry.class} IMPLEMENTATION.\n  METHOD z2ui5_if_app~main.\n  ENDMETHOD.\nENDCLASS.\n`,
    }),
  );
  await page.goto(`/samples/${entry.page}`);

  await expect(page.locator(".demo iframe")).toHaveCount(0);
  await page.locator(".abap2ui5-demo-start").click();

  // What it mounts is this site's own playground, embedded, on this sample -
  // the loader builds the URL, so the page cannot disagree with the frame.
  const frame = page.locator(".demo iframe");
  await expect(frame).toHaveCount(1);
  const src = new URL(await frame.getAttribute("src"));
  expect(src.searchParams.get("embed")).toBe("1");
  // The APP and nothing else: no editor, no toolbar, no status line. A page
  // that prints the whole class two screens down does not need a second copy
  // of it inside a frame, and the editor is on the box in "Open the full
  // playground".
  expect(src.searchParams.get("view")).toBe("app");
  expect(src.searchParams.getAll("src")).toEqual([entry.raw]);
  const inside = page.frameLocator(".demo iframe");
  await expect(inside.locator("#status")).toHaveText("running", { timeout: 180000 });
  await expect(inside.locator(".bar")).toBeHidden();
  await expect(inside.locator(".pane-left")).toBeHidden();
  await expect(inside.locator("#app")).toBeVisible();
});

test("a sample page prints the class itself, coloured and escaped", async ({ page }) => {
  // The class IS the sample, so it is on the page rather than one click away
  // on GitHub - fetched at build time (tools/sample-sources.mjs) and coloured
  // there too (tools/abap-highlight.mjs), because these pages carry no
  // highlighter. A reader who wanted to know how it does what it does has the
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
  // The two elements the writer puts in - the line and its numbered link -
  // and nothing else: what is left after those is the file, escaped.
  expect(code.replace(/<\/?(?:span|a)[^>]*>/g, "")).not.toMatch(/<[a-zA-Z/]/);
});

test("every line of the class has an address, and the numbers are not in the text", async () => {
  // GitHub's line links, on a page that has no editor. "Look at line 40 to 55"
  // is most of what one person tells another about a sample, and until this it
  // could only be said about the copy on GitHub.
  const { entry, html } = printed(12);
  expect(entry, "a page prints a class of at least twelve lines").toBeTruthy();

  const count = (html.match(/<span class="ln" id="L/g) || []).length;
  expect(html).toContain('<span class="ln" id="L1"><a href="#L1" aria-label="Line 1"></a>');
  expect(html).toContain(`<span class="ln" id="L${count}">`);
  expect(html).not.toContain(`<span class="ln" id="L${count + 1}">`);

  // The number is drawn by CSS from a counter, so the link that carries it is
  // EMPTY: a reader who selects the block and copies it gets ABAP they can
  // paste, not the class with nine hundred numbers down its left edge. That is
  // the whole reason the class is printed here rather than linked.
  // Nothing on the line's link but the two things that carry meaning: where it
  // points, and what it is called. This markup is repeated once per line of
  // every class the set prints - 191,000 of them - so an attribute a
  // stylesheet can do without is two megabytes of Pages artifact.
  expect(html).not.toContain("data-line");
  expect(html).not.toContain('class="lnr"');
  for (const [, anchor] of html.matchAll(/<a href="#L\d+"[^>]*>([^<]*)<\/a>/g)) expect(anchor).toBe("");
  const css = fs.readFileSync(path.join(DIST, "samples", "sample.css"), "utf8");
  expect(css).toContain("content: counter(line)");
  expect(css).toContain("user-select: none");
});

test("a line link marks the line, a shift-click makes a passage, and the button hands it over", async ({ page, context }) => {
  const { entry } = printed(12);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto(`/samples/${entry.page}#L3-L5`);
  await expect(page.locator(".ln.is-marked")).toHaveCount(3);
  await expect(page.locator(".source-hint")).toHaveText("Lines 3–5");

  // A fresh visit offers the affordance and nothing else: there is no link to
  // copy until a line has been picked.
  await page.goto(`/samples/${entry.page}`);
  await expect(page.locator(".source-copy")).toBeHidden();
  await expect(page.locator(".source-hint")).toBeVisible();
  const history = await page.evaluate(() => history.length);

  await page.locator(".ln#L9 a").click();
  await expect(page).toHaveURL(/#L9$/);
  await expect(page.locator(".ln.is-marked")).toHaveCount(1);
  await page.locator(".ln#L12 a").click({ modifiers: ["Shift"] });
  await expect(page).toHaveURL(/#L9-L12$/);
  await expect(page.locator(".ln.is-marked")).toHaveCount(4);
  await expect(page.locator(".source-hint")).toHaveText("Lines 9–12");
  // The address bar IS the share link, so the selection is written to it with
  // replaceState: a reader who presses Back after picking three lines wants
  // the page they came from, not the two selections before this one.
  expect(await page.evaluate(() => history.length)).toBe(history);

  await page.locator(".source-copy").click();
  await expect(page.locator(".source-copy")).toHaveText("Link copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/#L9-L12$/);

  // What the block CONTAINS is still the file: the numbers are drawn, not written.
  const selected = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".source-body code"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return getSelection().toString();
  });
  expect(selected.split("\n")[0]).toMatch(/^\s*(CLASS|\*|")/);

  // The gutter is sticky, because an abap2UI5 view is a chain written wide and
  // a number that has scrolled out of the box is a number nobody can read a
  // link off - over an opaque background, so a marked line does not get a
  // white column punched down its left edge.
  await page.evaluate(() => { document.querySelector(".source-body").scrollLeft = 300; });
  const box = await page.locator(".ln#L9 a").boundingBox();
  const pre = await page.locator(".source-body").boundingBox();
  expect(Math.abs(box.x - pre.x)).toBeLessThan(2);
  const line = await page.locator(".ln#L9").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await page.locator(".ln#L9 a").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(line);
});

test("a link into a class that was cut off says so rather than highlighting nothing", async ({ page }) => {
  // A long class is printed as far as its first 900 lines (tools/sample-pages.mjs),
  // so a link into what was cut is a question the page has to answer out loud.
  const { entry, html } = printed(12);
  const count = (html.match(/<span class="ln" id="L/g) || []).length;
  await page.goto(`/samples/${entry.page}#L${count + 500}`);
  await expect(page.locator(".source-hint")).toContainText("is not on this page");
  await expect(page.locator(".ln.is-marked")).toHaveCount(0);
});

test.describe("with the script blocked", () => {
  test.use({ javaScriptEnabled: false });

  test("a link to one line still highlights it", async ({ page }) => {
    // :target is the browser's own answer to #L42, and it is what these pages
    // fall back to: the script is needed for the RANGE - a fragment no element
    // has an id for - and for the shift-click that composes one.
    const { entry } = printed(12);
    await page.goto(`/samples/${entry.page}#L3`);
    const marked = await page.locator(".ln#L3").evaluate((el) => getComputedStyle(el).backgroundColor);
    const plain = await page.locator(".ln#L4").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(marked).not.toBe(plain);
    expect(await page.locator(".ln#L1 a").evaluate((el) => getComputedStyle(el, "::before").content))
      .toBe("counter(line)");
  });
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

test("the full playground opens on the sample, and offers the way back", async ({ page }) => {
  // The round trip that used to start on a card in the catalogue starts here
  // now: the card is a link to this page, and this page is where Run is - in
  // the page as a demo box, and on the box as the link to the whole thing.
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
  // cannot find is worse than one they cannot run. What it does not get is a
  // demo box: a start button that could only ever fail is not an offer.
  expect(html).not.toContain('class="run"');
  expect(html).not.toContain('class="abap2ui5-demo"');
  expect(html).not.toContain("abap2ui5-embed.js");
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
  // The bar is the catalogue's, so the stylesheet beside it is loading - and
  // it names the part of the site this page is in rather than its neighbour:
  // the brand is the mark and the name, and Samples is the current nav item,
  // which is what makes it the bold one and what a screen reader announces.
  await expect(page.locator(".brand")).toHaveText("abap2UI5");
  await expect(page.locator(".brand")).toHaveAttribute("href", "../../samples/");
  await expect(page.locator(".bar-nav > *")).toHaveText(["Home", "Documentation", "Samples", "Playground"]);
  await expect(page.locator(".bar .search-button")).toBeVisible();
  const here = page.locator(".bar-nav a", { hasText: "Samples" });
  await expect(here).toBeVisible();
  await expect(here).toHaveAttribute("aria-current", "page");
  expect(await here.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("600");
  // The theme switch is in the menu behind the bar's last button, as on the
  // catalogue - and both work here too, without a bundle: the menu opens on
  // its button and closes on a click anywhere else; a press on the switch turns
  // the page dark and is kept under the site's one key; a press back to what
  // the system says is forgotten rather than stored, the rule the other two
  // documents follow.
  await page.emulateMedia({ colorScheme: "light" });
  const more = page.locator(".bar .extra");
  const theme = page.locator("#theme");
  await expect(theme).toBeHidden();
  await more.locator("summary").click();
  await expect(theme).toBeVisible();
  const stored = () => page.evaluate(() => localStorage.getItem("abap2ui5-playground:theme"));
  await theme.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await stored()).toBe("dark");
  await theme.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await stored()).toBe(null);
  await page.locator("h1").click();
  await expect(theme).toBeHidden();
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
