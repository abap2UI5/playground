import { test, expect } from "@playwright/test";

// The sample catalogue at /samples/ - the page that replaced the three
// repository Pages sites.
//
// What it has to be, and what these tests hold it to:
//
//   ADDRESSABLE. Its filters live in the URL, so a search can be linked, sent
//   or bookmarked. That is the one thing the examples dialog in the shell
//   could never do, and the reason this page exists beside it.
//   ANSWERING THE QUESTION THE SIDECARS CANNOT. "Which sample uses sap.m.Table
//   at all" - not the one filed under it. That answer comes from the linter,
//   through each repository's catalogue-derived.json, and the control facet is
//   where a reader gets at it.
//   HONEST ABOUT WHAT CANNOT RUN. A sample that needs a system or SAPUI5 is
//   listed and says so, because a sample somebody cannot find is worse than
//   one they cannot run.
//   ONE WAY ON. A card is a link to the sample's own page and nothing else.
//   Run, GitHub and the documentation are on that page - a demo box that runs
//   the sample in it, and two facts in its facts - because a list whose rows
//   each offered three ways off the site made the page underneath them look
//   like something that did not exist. The round trip that starts at Run is
//   held in tests/sample-pages.spec.js, where Run now is.
//
// It reads one same-origin file, samples/apps.json, so the fixture is that
// index. Nothing here reaches a foreign host.

const CORS = { "access-control-allow-origin": "*" };
const json = (data) => ({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(data) });

const raw = (repo, file, branch = "main") => `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
const blob = (repo, file, branch = "main") => `https://github.com/${repo}/blob/${branch}/${file}`;

const CONTROLS = ["sap.m.Page", "sap.m.Table", "sap.m.Breadcrumbs", "sap.ui.comp.smarttable.SmartTable"];

const row = (over) => ({
  source: "controls",
  minUi5: "1.71",
  controls: [0],
  libraries: ["sap.m"],
  runs: true,
  keywords: [],
  ...over,
  /* Stamped on every entry by the writer of the per-sample pages
   * (tools/sample-pages.mjs), and the only thing a card links to - so the
   * fixture carries it exactly as the real index does. */
  page: `${over.class}/`,
});

const INDEX = {
  built: "2026-09-03T00:00:00.000Z",
  ui5: "1.151.0",
  minUi5: "1.71",
  carries: ["sap.ui.core", "sap.m", "sap.f"],
  sources: [
    { id: "learn", repo: "abap2UI5/samples", title: "Learn", blurb: "The path through abap2UI5 itself.", ok: true, count: 2 },
    { id: "controls", repo: "abap2UI5/samples-controls", title: "Controls", blurb: "The UI5 demo kit rebuilt in ABAP.", ok: true, count: 2 },
    { id: "stack", repo: "abap2UI5/samples-stack", title: "Stack", blurb: "abap2UI5 with a real system behind it.", ok: true, count: 1 },
  ],
  stages: [
    { id: "start", title: "Start here", blurb: "Five apps in reading order.", source: "learn" },
    { id: "rows", title: "Show many rows", blurb: "Internal tables on screen.", source: "learn" },
  ],
  releases: ["1.71", "1.84", "1.120"],
  libraries: ["sap.m", "sap.ui.comp"],
  controls: CONTROLS,
  entries: [
    row({
      source: "learn", class: "z2ui5_cl_smp_app_493", title: "Basics I",
      note: "Hello World, the Smallest App", group: "Basics", stage: "start",
      docs: ["https://abap2ui5.github.io/docs/get_started/hello_world"],
      raw: raw("abap2UI5/samples", "src/01/z2ui5_cl_smp_app_493.clas.abap"),
      github: blob("abap2UI5/samples", "src/01/z2ui5_cl_smp_app_493.clas.abap"),
    }),
    row({
      source: "learn", class: "z2ui5_cl_smp_app_040", title: "Responsive Table I",
      note: "An internal table on screen", group: "Table", stage: "rows", controls: [0, 1],
      raw: raw("abap2UI5/samples", "src/01/z2ui5_cl_smp_app_040.clas.abap"),
      github: blob("abap2UI5/samples", "src/01/z2ui5_cl_smp_app_040.clas.abap"),
    }),
    // Filed under Breadcrumbs, BUILDS a Table: the whole point of the control
    // facet is that this one answers "uses sap.m.Table" and its title does not.
    row({
      class: "z2ui5_cl_smpc_app_003", title: "Breadcrumbs",
      note: "A trail of links back to where the user came from", group: "sap.m",
      entity: "sap.m.Breadcrumbs", controls: [0, 1, 2],
      raw: raw("abap2UI5/samples-controls", "src/01/01/z2ui5_cl_smpc_app_003.clas.abap"),
      github: blob("abap2UI5/samples-controls", "src/01/01/z2ui5_cl_smpc_app_003.clas.abap"),
    }),
    row({
      class: "z2ui5_cl_smpc_app_901", title: "Newer Control", note: "needs a UI5 past the floor",
      group: "sap.m", minUi5: "1.120", since: [{ name: "sap.m.Something.prop", since: "1.120" }],
      raw: raw("abap2UI5/samples-controls", "src/02/z2ui5_cl_smpc_app_901.clas.abap"),
      github: blob("abap2UI5/samples-controls", "src/02/z2ui5_cl_smpc_app_901.clas.abap"),
    }),
    row({
      class: "z2ui5_cl_smpc_app_900", title: "Smart Table", note: "SAPUI5 only",
      group: "sap.ui.comp", controls: [3], libraries: ["sap.ui.comp"],
      runs: false, needs: "needs SAPUI5", needsDetail: "sap.ui.comp",
      raw: raw("abap2UI5/samples-controls", "src/03/z2ui5_cl_smpc_app_900.clas.abap"),
      github: blob("abap2UI5/samples-controls", "src/03/z2ui5_cl_smpc_app_900.clas.abap"),
    }),
    row({
      source: "stack", class: "z2ui5_cl_smps_app_314", title: "Switch Default Model",
      note: "device, HTTP and OData model side by side", group: "Smart Controls",
      runs: false, needs: "needs a system", needsDetail: "SAPUI5 + an activated Gateway service",
      raw: raw("abap2UI5/samples-stack", "src/02/z2ui5_cl_smps_app_314.clas.abap", "02-smart-controls"),
      github: blob("abap2UI5/samples-stack", "src/02/z2ui5_cl_smps_app_314.clas.abap", "02-smart-controls"),
    }),
  ],
};

async function openCatalogue(page, query = "") {
  await page.route("**/samples/apps.json", (route) => route.fulfill(json(INDEX)));
  await page.goto(`/samples/${query}`);
  await expect(page.locator("#count")).toContainText("samples");
}

const count = (page) => page.locator("#count");

test("every sample is listed, the learning path in its own order", async ({ page }) => {
  await openCatalogue(page);

  await expect(count(page)).toHaveText("6 samples");
  await expect(page.locator(".card")).toHaveCount(6);

  // Unfiltered, the path is drawn as stages in the repository's reading order
  // - that order is the one thing on this page nobody could derive, so it is
  // not thrown away in favour of an alphabetical list.
  await expect(page.locator(".stage h2")).toHaveText(["Start here", "Show many rows", "Controls", "Stack"]);
});

test("a search runs over what a sample BUILDS, not only what it is called", async ({ page }) => {
  await openCatalogue(page);

  // "table" is in two titles - and in a third sample's control list, which is
  // the port filed under Breadcrumbs.
  await page.fill("#q", "table");
  await expect(page.locator(".card h3")).toHaveText(["Responsive Table I", "Breadcrumbs", "Smart Table"]);

  // The control facet asks it precisely: sap.m.Table, not "table".
  await page.fill("#q", "");
  await page.selectOption("#f-control", "sap.m.Table");
  await expect(page.locator(".card h3")).toHaveText(["Responsive Table I", "Breadcrumbs"]);

  await page.selectOption("#f-control", "");
  await page.fill("#q", "zeppelin");
  await expect(page.locator(".card")).toHaveCount(0);
  await expect(page.locator(".empty")).toBeVisible();
});

test("the filters live in the URL, so a search is a link", async ({ page }) => {
  await openCatalogue(page);

  await page.fill("#q", "table");
  await page.selectOption("#f-source", "controls");
  await expect(page).toHaveURL(/[?&]q=table/);
  await expect(page).toHaveURL(/[?&]src=controls/);

  // And the other way round: the same link, opened cold, is the same list with
  // the same controls set - which is what makes it worth sending to somebody.
  await openCatalogue(page, "?q=table&src=controls&rel=1.84");
  await expect(page.locator("#q")).toHaveValue("table");
  await expect(page.locator("#f-source")).toHaveValue("controls");
  await expect(page.locator("#f-release")).toHaveValue("1.84");
  // "runs on 1.84" means "needs 1.84 or less", so the 1.120 port is out.
  await expect(page.locator(".card h3")).toHaveText(["Breadcrumbs", "Smart Table"]);

  // Clear takes the query string with it.
  await page.click("#clear");
  await expect(page).toHaveURL(/\/samples\/$/);
  await expect(count(page)).toHaveText("6 samples");
});

test("what cannot run here is listed, says why, and opens for reading", async ({ page }) => {
  await openCatalogue(page);

  const smart = page.locator(".card", { hasText: "Smart Table" });
  await expect(smart.locator(".badge.needs")).toHaveText("needs SAPUI5");
  // The long half is the tooltip, so a card stays the height of its neighbours.
  await expect(smart.locator(".badge.needs")).toHaveAttribute("title", "sap.ui.comp");
  // The line that says what a reader gets by opening it - here, not a Run.
  await expect(smart.locator(".more-why")).toHaveText("needs SAPUI5");
  await expect(smart.locator("a")).toHaveAttribute("href", "z2ui5_cl_smpc_app_900/");

  const stack = page.locator(".card", { hasText: "Switch Default Model" });
  await expect(stack.locator(".badge.needs")).toHaveText("needs a system");
  await expect(stack.locator(".more-why")).toHaveText("needs a system");
  await expect(stack.locator("a")).toHaveAttribute("href", "z2ui5_cl_smps_app_314/");

  // The box that hides them both.
  await page.check("#f-runs");
  await expect(page.locator(".card", { hasText: "Smart Table" })).toHaveCount(0);
  await expect(page.locator(".card", { hasText: "Switch Default Model" })).toHaveCount(0);
  await expect(count(page)).toHaveText("4 of 6 samples");

  // A port above the floor still runs here - this site is on 1.151 - and says
  // which release it needs rather than being hidden.
  await page.uncheck("#f-runs");
  const newer = page.locator(".card", { hasText: "Newer Control" });
  await expect(newer.locator(".badge", { hasText: "UI5 1.120" })).toBeVisible();
  await expect(newer.locator(".more-why")).toHaveText("runs in this browser");
});

test("a card is one link, and it goes to the sample's own page", async ({ page }) => {
  await openCatalogue(page);

  // Six cards, six links, and every one of them stays on this site. The three
  // that used to leave it - Run, Source, Docs - are on the page each of these
  // opens, where a reader who has decided is standing: Run as a demo box that
  // runs the sample in that page, the other two as facts.
  await expect(page.locator(".card a")).toHaveCount(6);
  await expect(page.locator(".card .run")).toHaveCount(0);
  await expect(page.locator('.card a[target="_blank"]')).toHaveCount(0);
  await expect(page.locator(".card .more-go").first()).toHaveText("Open the sample ›");

  // And the link is the whole card, not the line of text at the top of it: a
  // click in the middle of a row opens the row. This one is the third stage
  // down a page that scrolls, so it is scrolled to first: boundingBox() reads
  // the viewport and does not move it, and a coordinate below the fold is a
  // click on nothing at all.
  const card = page.locator(".card", { hasText: "Breadcrumbs" });
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  await card.click({ position: { x: box.width / 2, y: box.height - 6 } });
  await expect(page).toHaveURL(/\/samples\/z2ui5_cl_smpc_app_003\/$/);
});

test("a link that did not come from the catalogue still points at GitHub", async ({ page }) => {
  await page.route("**/src/01/z2ui5_cl_smp_app_493.clas.abap", (route) =>
    route.fulfill({
      status: 200, contentType: "text/plain", headers: CORS,
      body: "CLASS z2ui5_cl_smp_app_493 DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES z2ui5_if_app.\nENDCLASS.\n"
        + "CLASS z2ui5_cl_smp_app_493 IMPLEMENTATION.\n  METHOD z2ui5_if_app~main.\n  ENDMETHOD.\nENDCLASS.\n",
    }),
  );
  await page.goto(`/?src=${encodeURIComponent(raw("abap2UI5/samples", "src/01/z2ui5_cl_smp_app_493.clas.abap"))}`);
  const link = page.locator("#source-link");
  await expect(link).toHaveText("Source", { timeout: 120000 });
  await expect(link).toHaveAttribute(
    "href", blob("abap2UI5/samples", "src/01/z2ui5_cl_smp_app_493.clas.abap"),
  );
});

test("the bar ends where the playground's own bar ends", async ({ page }) => {
  await openCatalogue(page);
  // The mark and the name at one end - the nav already says Samples, in bold,
  // so the brand does not say it again.
  await expect(page.locator(".brand")).toHaveText("abap2UI5");
  await expect(page.locator(".brand img")).toBeVisible();
  // At the other, in this order: Documentation, Samples and Playground, then
  // the two marks, then the button that opens the rest.
  await expect(page.locator(".bar-nav > *")).toHaveText(["Documentation", "Samples", "Playground"]);
  await expect(page.locator('.bar-nav [aria-current="page"]')).toHaveText("Samples");
  await expect(page.locator('.bar-nav a[data-site="docs"]')).toHaveText("Documentation");
  // The way off this site is two marks at the end of the bar, the same two the
  // playground and the per-sample pages carry - so a reader moving between the
  // three documents reads them as one bar.
  await expect(page.locator(".bar .social")).toHaveCount(2);
  await expect(page.locator('.bar .social[href*="linkedin.com/company/abap2ui5"]')).toBeVisible();
  await expect(page.locator('.bar .social[href*="github.com/abap2UI5"]')).toBeVisible();
  // Inline SVG, not an icon font: it is drawn before any stylesheet has to
  // arrive, which is why it is repeated in three documents by hand.
  await expect(page.locator(".bar .social svg").first()).toBeVisible();
  // After them, one button for the rest: light or dark, the project's tools and
  // its repositories, in a menu that is closed until it is pressed and closes
  // again on Escape or on a click anywhere else.
  const more = page.locator(".bar .extra");
  const theme = page.locator("#theme");
  await expect(more.locator("summary")).toBeVisible();
  await expect(theme).toBeHidden();
  await more.locator("summary").click();
  await expect(theme).toBeVisible();
  expect(await more.locator(".menu a").count()).toBeGreaterThanOrEqual(10);
  for (const part of ["github.com/abap2UI5/linter", "github.com/abap2UI5/vscode-extension", "github.com/abap2UI5-addons"]) {
    await expect(more.locator(`.menu a[href*="${part}"]`)).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(theme).toBeHidden();
  await more.locator("summary").click();
  await expect(theme).toBeVisible();
  await page.locator("h1").click();
  await expect(theme).toBeHidden();
});

test("a broken index says so rather than showing an empty page", async ({ page }) => {
  await page.route("**/samples/apps.json", (route) =>
    route.fulfill({ status: 404, contentType: "text/plain", body: "404" }),
  );
  await page.goto("/samples/");
  await expect(page.locator(".empty")).toContainText("could not be loaded");
});
