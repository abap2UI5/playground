import { test, expect } from "@playwright/test";
import { control, open, openFiles, SAMPLES } from "./helpers.mjs";

// The examples browser: the sample catalogue, read when the Examples button is
// clicked, listed next to the samples the page carries, and opened through the same
// path a ?src= link takes.
//
// It reads ONE file and it is this site's own - samples/apps.json, written at
// build time by tools/build-catalogue.mjs from the six catalogues the three
// repositories commit. So the fixture below is that index rather than three
// foreign catalogues, and every test intercepts the one URL: the success cases
// because a test must not depend on what those repositories currently hold,
// the failure cases because failing is what is being staged. The raw host is
// still intercepted for the CLASS a row opens, which does come from there.

const INDEX_URL = "**/samples/apps.json";

// raw.githubusercontent.com answers with CORS `*` - on hits and misses alike -
// and the fulfilled responses have to say the same or the browser would turn
// them into opaque failures instead of the staged answers.
const CORS = { "access-control-allow-origin": "*" };

const json = (data) => ({
  status: 200,
  contentType: "application/json",
  headers: CORS,
  body: JSON.stringify(data),
});

const raw = (repo, file, branch = "main") => `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
const blob = (repo, file, branch = "main") => `https://github.com/${repo}/blob/${branch}/${file}`;

// The merged index, cut down to what these tests need but in the real shape:
// a controls dictionary every entry indexes into, the learning path's stages,
// one source block per repository, and the `runs`/`needs` pair the build
// computed against this site's UI5 libraries.
const CONTROLS = ["sap.m.Page", "sap.m.Table", "sap.m.Breadcrumbs", "sap.ui.comp.smarttable.SmartTable"];

const entry = (over) => ({
  source: "controls",
  minUi5: "1.71",
  controls: [0],
  libraries: ["sap.m"],
  runs: true,
  keywords: [],
  ...over,
});

const APPS_INDEX = {
  built: "2026-09-03T00:00:00.000Z",
  ui5: "1.151.0",
  minUi5: "1.71",
  carries: ["sap.ui.core", "sap.m", "sap.f"],
  sources: [
    { id: "learn", repo: "abap2UI5/samples", title: "Learn", blurb: "The path through abap2UI5 itself.", ok: true, count: 2 },
    { id: "controls", repo: "abap2UI5/samples-controls", title: "Controls", blurb: "The UI5 demo kit rebuilt in ABAP.", ok: true, count: 3 },
    { id: "stack", repo: "abap2UI5/samples-stack", title: "Stack", blurb: "abap2UI5 with a real system behind it.", ok: true, count: 1 },
  ],
  stages: [
    { id: "start", title: "Start here", blurb: "Five apps in reading order.", source: "learn" },
    { id: "rows", title: "Show many rows", blurb: "Internal tables on screen.", source: "learn" },
  ],
  releases: ["1.71", "1.120"],
  libraries: ["sap.m", "sap.ui.comp"],
  controls: CONTROLS,
  entries: [
    entry({
      source: "learn",
      class: "z2ui5_cl_smp_app_493",
      title: "Basics I",
      note: "Hello World, the Smallest App",
      summary: "The smallest app that runs.",
      group: "Basics",
      stage: "start",
      keywords: ["hello", "world", "smallest"],
      raw: raw("abap2UI5/samples", "src/01/z2ui5_cl_smp_app_493.clas.abap"),
      github: blob("abap2UI5/samples", "src/01/z2ui5_cl_smp_app_493.clas.abap"),
    }),
    entry({
      source: "learn",
      class: "z2ui5_cl_smp_app_040",
      title: "Responsive Table I",
      note: "An internal table on screen",
      group: "Table",
      stage: "rows",
      controls: [0, 1],
      keywords: ["table", "rows"],
      raw: raw("abap2UI5/samples", "src/01/z2ui5_cl_smp_app_040.clas.abap"),
      github: blob("abap2UI5/samples", "src/01/z2ui5_cl_smp_app_040.clas.abap"),
    }),
    entry({
      class: "z2ui5_cl_smpc_app_003",
      title: "Breadcrumbs",
      note: "A trail of links back to where the user came from",
      group: "sap.m",
      entity: "sap.m.Breadcrumbs",
      sample: "sap.m.sample.Breadcrumbs",
      controls: [0, 2],
      keywords: ["breadcrumbs", "sap.m", "link", "trail"],
      raw: raw("abap2UI5/samples-controls", "src/01/01/z2ui5_cl_smpc_app_003.clas.abap"),
      github: blob("abap2UI5/samples-controls", "src/01/01/z2ui5_cl_smpc_app_003.clas.abap"),
    }),
    // The SAPUI5-only collection: listed, never offered.
    entry({
      class: "z2ui5_cl_smpc_app_900",
      title: "Smart Table",
      note: "SAPUI5 only",
      group: "sap.ui.comp",
      controls: [3],
      libraries: ["sap.ui.comp"],
      runs: false,
      needs: "needs SAPUI5",
      needsDetail: "sap.ui.comp",
      raw: raw("abap2UI5/samples-controls", "src/03/z2ui5_cl_smpc_app_900.clas.abap"),
      github: blob("abap2UI5/samples-controls", "src/03/z2ui5_cl_smpc_app_900.clas.abap"),
    }),
    // A library this build does not carry, and not one only SAPUI5 has: the
    // row names the library rather than the runtime, because that is the
    // honest answer to why it will not load here.
    entry({
      class: "z2ui5_cl_smpc_app_902",
      title: "Web Component",
      note: "a library this site does not build in",
      group: "sap.ui.webc.main",
      libraries: ["sap.ui.webc.main"],
      runs: false,
      needs: "needs sap.ui.webc.main",
      raw: raw("abap2UI5/samples-controls", "src/02/z2ui5_cl_smpc_app_902.clas.abap"),
      github: blob("abap2UI5/samples-controls", "src/02/z2ui5_cl_smpc_app_902.clas.abap"),
    }),
    // Above the floor: what the "newer than 1.71" box hides.
    entry({
      class: "z2ui5_cl_smpc_app_901",
      title: "Newer Control",
      note: "needs a UI5 past the floor",
      group: "sap.m",
      minUi5: "1.120",
      since: [{ name: "sap.m.Something.prop", since: "1.120" }],
      raw: raw("abap2UI5/samples-controls", "src/02/z2ui5_cl_smpc_app_901.clas.abap"),
      github: blob("abap2UI5/samples-controls", "src/02/z2ui5_cl_smpc_app_901.clas.abap"),
    }),
    // On a delivery branch of its own, and no system here to run it on.
    entry({
      source: "stack",
      class: "z2ui5_cl_smps_app_314",
      title: "Switch Default Model",
      note: "device, HTTP and OData model side by side",
      group: "Smart Controls",
      runs: false,
      needs: "needs a system",
      needsDetail: "SAPUI5 + an activated Gateway service",
      keywords: ["odata", "model", "smart"],
      raw: raw("abap2UI5/samples-stack", "src/02/z2ui5_cl_smps_app_314.clas.abap", "02-smart-controls"),
      github: blob("abap2UI5/samples-stack", "src/02/z2ui5_cl_smps_app_314.clas.abap", "02-smart-controls"),
    }),
  ],
};

// What a catalogued class looks like when its raw URL is fetched: one global
// class named after its file, the shape abapGit serves.
const catalogueAbap = (cls) => `CLASS ${cls} DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA note TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.

ENDCLASS.


CLASS ${cls} IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    IF client->check_on_init( ) = abap_false AND client->check_on_navigated( ) = abap_false.
      RETURN.
    ENDIF.

    note = \`This class came from the samples catalogue.\`.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`        v = \`sap.m\`
            )->a( n = \`xmlns:mvc\`    v = \`sap.ui.core.mvc\`
            )->a( n = \`displayBlock\` v = \`true\`
            )->a( n = \`height\`       v = \`100%\` ).

    DATA(page) = view->ele( \`Shell\`
        )->ele( \`Page\`
            )->a( n = \`title\` v = \`Catalogued example\` ).

    page->tag( \`Text\`
        )->a( n = \`id\`   v = \`txtNote\`
        )->a( n = \`text\` v = client->_bind( note ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
`;

async function serveCatalogues(page) {
  await page.route(INDEX_URL, (route) => route.fulfill(json(APPS_INDEX)));
  for (const repo of ["samples", "samples-controls", "samples-stack"]) {
    await page.route(`https://raw.githubusercontent.com/abap2UI5/${repo}/*/src/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        headers: CORS,
        body: catalogueAbap(route.request().url().split("/").pop().replace(".clas.abap", "")),
      }),
    );
  }
}

// Opens the browser and waits until the index has answered - the "looking…"
// line leaving is the module saying it is done loading.
async function openBrowser(page) {
  await page.locator("#examples").click();
  await expect(page.locator("#examples-dialog")).toBeVisible();
  await expect(page.locator("#examples-body")).not.toContainText("looking in the sample repositories", {
    timeout: 30000,
  });
}

test("the index is listed by learning-path stage, and an entry runs through the ?src= path", async ({
  page,
}) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  // The reader's own drafts first (none yet, but the row that saves one),
  // then the ones the page carries, then the samples repository in reading order, then
  // the controls grouped by library.
  await expect(page.locator(".examples-group").first()).toHaveText("Your drafts");
  await expect(page.locator(".examples-group").nth(1)).toHaveText("In the page");
  await expect(page.locator(".examples-group", { hasText: "Start here" })).toBeVisible();
  await expect(page.locator(".examples-group", { hasText: "Show many rows" })).toBeVisible();
  await expect(page.locator(".examples-group", { hasText: "Controls — sap.m" })).toBeVisible();

  // The frame's src carries a counter that goes up once per run, so waiting on
  // it is what proves a new app started - the status line alone still says
  // "running" from the app before (see runSample in helpers.mjs).
  const before = await page.locator("#app").getAttribute("src");
  await page.locator(".example-row", { hasText: "z2ui5_cl_smp_app_493" }).click();
  await expect(page.locator("#examples-dialog")).toBeHidden();
  await expect(page.locator("#app")).not.toHaveAttribute("src", before ?? "", { timeout: 60000 });
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });

  // The class kept the name the repository gave it, and it is what runs.
  expect(await openFiles(page)).toEqual(["z2ui5_cl_smp_app_493.clas.abap"]);
  await expect(control(page, "txtNote")).toContainText("came from the samples catalogue");

  // It arrived through deep-link.mjs, so it carries what linked code carries:
  // the way back to where it lives, as the page a human would want.
  await expect(page.locator("#source-link")).toBeVisible();
  expect(await page.locator("#source-link").getAttribute("href")).toBe(
    "https://github.com/abap2UI5/samples/blob/main/src/01/z2ui5_cl_smp_app_493.clas.abap",
  );

});

test("the search narrows the list across every group", async ({ page }) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  // A controls keyword: only that port stays, the other groups go.
  await page.locator("#examples-search").fill("breadcrumbs");
  await expect(page.locator(".example-row")).toHaveCount(1);
  await expect(page.locator(".example-row")).toContainText("Breadcrumbs");

  // A word nothing carries says so rather than showing an empty page.
  await page.locator("#examples-search").fill("zeppelin");
  await expect(page.locator(".example-row")).toHaveCount(0);
  await expect(page.locator("#examples-body")).toContainText("Nothing here matches that.");

  // Clearing the search brings everything back.
  await page.locator("#examples-search").fill("");
  await expect(page.locator(".example-row", { hasText: "Basics I" })).toBeVisible();
});

// The regression behind the `toBeHidden` above, staged rather than waited for.
// UI5 focuses a control as a render settles, and the app is a document of its
// own, so showModal() cannot stop it: the browser would look focused, take
// none of the typing, and not close on Escape. src/shell/frontend-bridge.js
// makes the frame decline the focus while a dialog is open, which is what this
// asserts - by doing to the frame exactly what UI5 does to it.
test("the running app cannot take the focus off the examples browser", async ({ page }) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  const app = page.frames().find((f) => f !== page.mainFrame());
  expect(app).toBeTruthy();
  // What UI5 does at the end of a render, on an element of its own so the test
  // does not depend on which control the app happens to have: focus() it and
  // report whether the focus actually went there.
  const appTakesFocus = () =>
    app.evaluate(() => {
      const probe = document.createElement("input");
      document.body.append(probe);
      probe.focus();
      const took = document.activeElement === probe;
      probe.remove();
      return took;
    });

  expect(await appTakesFocus()).toBe(false);

  // Still in the dialog, so the search box gets what is typed...
  await expect(page.locator("#examples-dialog")).toBeVisible();
  await page.keyboard.type("breadcrumbs");
  await expect(page.locator("#examples-search")).toHaveValue("breadcrumbs");
  await expect(page.locator(".example-row")).toHaveCount(1);

  // ...and Escape still reaches the dialog rather than the app. Twice, because
  // the box is <input type="search"> and the browser spends the first one
  // emptying it - which is the search field behaving as a search field, and is
  // also proof that this key went to the dialog and not to the frame.
  await page.keyboard.press("Escape");
  await expect(page.locator("#examples-search")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#examples-dialog")).toBeHidden();

  // With the dialog gone the app has its focus back, which is the half of this
  // that must not be traded away: the frame declines the focus while a dialog
  // is open over it, not for good.
  expect(await appTakesFocus()).toBe(true);
});

test("entries the playground cannot run are listed, say why, cannot be clicked, and link to GitHub", async ({ page }) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  // The port that runs is there and says nothing; the SAPUI5-only collection
  // entry, the port whose library is not built into this site and the stack
  // sample are there too, each saying what it needs and disabled - this
  // browser is where the repositories' own pages used to be, and a sample
  // somebody cannot find is worse than one they cannot run.
  //
  // WHICH of them cannot run is decided once, at build time, against
  // UI5_LIBRARIES and the release this site pins (tools/build-catalogue.mjs);
  // the dialog only shows what the index computed. That is why the fixture
  // carries `runs` and `needs` rather than a library for this module to judge.
  const runs = page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_003" });
  await expect(runs).toBeVisible();
  await expect(runs).toBeEnabled();
  await expect(runs.locator(".example-needs")).toHaveCount(0);
  const sapui5 = page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_900" });
  await expect(sapui5.locator(".example-needs")).toHaveText("needs SAPUI5");
  await expect(sapui5).toBeDisabled();
  // A library this build does not carry and SAPUI5 does not own either: the
  // row names the library, because "needs SAPUI5" would be a wrong answer.
  const webc = page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_902" });
  await expect(webc.locator(".example-needs")).toHaveText("needs sap.ui.webc.main");
  await expect(webc).toBeDisabled();
  const stack = page.locator(".example-row", { hasText: "z2ui5_cl_smps_app_314" });
  await expect(page.locator(".examples-group", { hasText: "Stack — Smart Controls" })).toBeVisible();
  await expect(stack.locator(".example-needs")).toContainText("needs a system");
  await expect(stack).toBeDisabled();
  await expect(page.locator("#examples-count")).toHaveText(/^\d+ of \d+$/);

  // Every row links to the file on GitHub - the stack one on its own branch.
  const item = page.locator(".example-item", { hasText: "z2ui5_cl_smps_app_314" });
  await expect(item.locator(".example-github")).toHaveAttribute(
    "href",
    "https://github.com/abap2UI5/samples-stack/blob/02-smart-controls/src/02/z2ui5_cl_smps_app_314.clas.abap",
  );
  await expect(page.locator(".example-item", { hasText: "z2ui5_cl_smpc_app_003" }).locator(".example-github")).toHaveAttribute(
    "href",
    "https://github.com/abap2UI5/samples-controls/blob/main/src/01/01/z2ui5_cl_smpc_app_003.clas.abap",
  );
  // A sample the page carries links to the same file a catalogued row would:
  // they ARE catalogue entries, in abap2UI5/samples, and the only thing
  // different about them is that they travelled with the page.
  const carried = SAMPLES[0];
  await expect(
    page.locator(".example-item", { has: page.locator(`[data-sample="${carried.id}"]`) }).locator(".example-github"),
  ).toHaveAttribute("href", carried.github);
  for (const href of await page.locator(".example-github").evaluateAll((as) => as.map((a) => a.href))) {
    expect(href, "every row links to ABAP, not to the code that carries it").toMatch(/\.clas\.abap$/);
  }

  // The filters cut them away: "OpenUI5 only" takes what needs SAPUI5, the
  // Stack box the stack - and what was ticked is remembered for the next open.
  await page.locator('input[data-filter="openui5only"]').check();
  await expect(sapui5).toHaveCount(0);
  await expect(stack).toBeVisible();
  await expect(runs).toBeVisible();
  await page.locator('input[data-filter="openui5only"]').uncheck();
  await page.locator('input[data-filter="stack"]').uncheck();
  await expect(stack).toHaveCount(0);
  await expect(sapui5).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#examples-dialog")).toBeHidden();
  await openBrowser(page);
  await expect(page.locator('input[data-filter="stack"]')).not.toBeChecked();
  await page.locator('input[data-filter="stack"]').check();
});

test("the browser is a big modal over the page, with the filters down its side", async ({ page }) => {
  // What the dialog is FOR: 770-odd samples wanted the screen, not a 44rem
  // column of one-line rows beside the editor. So it takes near enough all of
  // the viewport and the page behind it goes dark - and the filters live in a
  // side of their own, which is what the width bought.
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  const viewport = page.viewportSize();
  const box = await page.locator("#examples-dialog").boundingBox();
  expect(box.width).toBeGreaterThan(viewport.width * 0.9);
  expect(box.height).toBeGreaterThan(viewport.height * 0.9);

  // The side carries the boxes, the facets and the way across to the page;
  // the list is beside it, not under them.
  const side = page.locator(".examples-side");
  await expect(side.locator('input[data-filter="learn"]')).toBeVisible();
  await expect(side.locator("#examples-control")).toBeVisible();
  await expect(side.locator(".examples-all")).toBeVisible();
  const sideBox = await side.boundingBox();
  const listBox = await page.locator("#examples-body").boundingBox();
  expect(listBox.x).toBeGreaterThanOrEqual(sideBox.x + sideBox.width - 1);
  // And the width is spent on the rows: more than one column of them.
  const rows = await page.locator(".example-row").evaluateAll((els) =>
    els.slice(0, 6).map((e) => e.getBoundingClientRect().left));
  expect(new Set(rows).size).toBeGreaterThan(1);
});

test("the facets ask what only the index can answer: control, library, release", async ({ page }) => {
  // The two questions the sample repositories' own catalogues cannot answer -
  // which samples BUILD a control, and what renders on a given release - are
  // why the index carries the linter's derived half at all. The catalogue page
  // has had them since it replaced the three repository pages; the dialog now
  // asks them too, off the same index.
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  // Uses control: the port that builds a Breadcrumbs, and nothing else.
  await page.locator("#examples-control").selectOption("sap.m.Breadcrumbs");
  await expect(page.locator(".example-row")).toHaveCount(1);
  await expect(page.locator(".example-row")).toContainText("z2ui5_cl_smpc_app_003");
  // The built-ins and the drafts go with it, unlike under the boxes: a facet
  // asks something they have no answer to, and a row with no answer is not a
  // match for one.
  await expect(page.locator(".example-row[data-sample]")).toHaveCount(0);
  await page.locator("#examples-control").selectOption("");

  // Library: the SAPUI5-only collection is this fixture's one sap.ui.comp row.
  await page.locator("#examples-library").selectOption("sap.ui.comp");
  await expect(page.locator(".example-row")).toHaveCount(1);
  await expect(page.locator(".example-row")).toContainText("z2ui5_cl_smpc_app_900");

  // Kept between opens, the way the boxes are.
  await page.keyboard.press("Escape");
  await expect(page.locator("#examples-dialog")).toBeHidden();
  await page.locator("#examples").click();
  await expect(page.locator("#examples-library")).toHaveValue("sap.ui.comp");
  await page.locator("#examples-library").selectOption("");

  // Runs on UI5 1.71 means "needs 1.71 or less" - the question is what a
  // system can render, not what a sample was filed under.
  await page.locator("#examples-release").selectOption("1.71");
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_901" })).toHaveCount(0);
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_003" })).toBeVisible();

  // Clear puts every box, every facet and the search back, and then has
  // nothing left to offer, so it hides itself.
  await page.locator("#examples-search").fill("breadcrumbs");
  await page.locator("#examples-clear").click();
  await expect(page.locator("#examples-search")).toHaveValue("");
  await expect(page.locator("#examples-release")).toHaveValue("");
  await expect(page.locator("#examples-clear")).toBeHidden();
  await expect(page.locator(".example-row[data-sample]").first()).toBeVisible();
});

test("\"Only what runs here\" drops the rows that cannot be clicked anyway", async ({ page }) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  await page.locator('input[data-filter="runsonly"]').check();
  await expect(page.locator(".example-row:disabled")).toHaveCount(0);
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_003" })).toBeVisible();
  // The built-ins run here and stay - they are the page's own.
  await expect(page.locator(".example-row[data-sample]").first()).toBeVisible();
  await page.locator('input[data-filter="runsonly"]').uncheck();
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smps_app_314" })).toBeVisible();
});

test("a row carries what the index knows: its group, its release, and why it will not run", async ({ page }) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  // The group the repository filed it under, on every catalogued row.
  const port = page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_003" });
  await expect(port.locator(".example-badge", { hasText: "sap.m" })).toBeVisible();

  // The release, only where it is above the floor: "UI5 1.71" on seven hundred
  // rows would say nothing the floor does not already say.
  const newer = page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_901" });
  await expect(newer.locator(".example-badge", { hasText: "UI5 1.120" })).toBeVisible();
  await expect(port.locator(".example-badge", { hasText: "UI5 " })).toHaveCount(0);

  // The long half of "needs" is the badge's tooltip - a stack sample's
  // prerequisite is a sentence, and a sentence in a badge is not a row.
  const stack = page.locator(".example-row", { hasText: "z2ui5_cl_smps_app_314" });
  await expect(stack.locator(".example-needs")).toHaveAttribute(
    "title",
    "SAPUI5 + an activated Gateway service",
  );
  // And what made a row that release, where the linter said so.
  await expect(newer.locator(".example-needs")).toHaveCount(0);
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_900" }).locator(".example-needs"))
    .toHaveAttribute("title", "sap.ui.comp");
});

test("the search takes several words, in any order", async ({ page }) => {
  // One string compared whole found nothing for "table rows"; every word
  // somewhere in the row finds the sample either way round.
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  const row = page.locator(".example-row", { hasText: "z2ui5_cl_smp_app_040" });
  await page.locator("#examples-search").fill("table rows");
  await expect(row).toBeVisible();
  const oneWay = await page.locator(".example-row").allTextContents();
  await page.locator("#examples-search").fill("rows table");
  await expect(row).toBeVisible();
  // The same rows either way round, whatever else happens to match both words -
  // the samples the page carries are abap2UI5/samples' own and a pin may bring
  // one that does, which is a correct match and not a reason to count here.
  expect(await page.locator(".example-row").allTextContents()).toEqual(oneWay);
});

test("the release filter hides what needs a UI5 newer than 1.71", async ({ page }) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);
  // src/01 runs on 1.71 and stays; src/02 needs a newer UI5 and goes.
  await page.locator('input[data-filter="newer"]').uncheck();
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_003" })).toBeVisible();
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_901" })).toHaveCount(0);
  // The carried samples stay whatever the boxes say: they came with the page.
  await expect(page.locator(".example-row[data-sample]").first()).toBeVisible();
  await page.locator('input[data-filter="newer"]').check();
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_901" })).toBeVisible();
});

test("without the index the browser degrades to the samples in the page, quietly", async ({ page }) => {
  // A broken deploy, or a first visit with no network. The browser keeps
  // working on what is always here.
  await page.route(INDEX_URL, (route) =>
    route.fulfill({ status: 404, contentType: "text/plain", headers: CORS, body: "404: Not Found" }),
  );

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await open(page);
  await openBrowser(page);

  // Only the drafts' row and the carried samples - every one of them, searchable -
  // and not a word about what could not be fetched.
  await expect(page.locator(".examples-group")).toHaveText(["Your drafts", "In the page"]);
  await expect(page.locator(".example-row")).toHaveCount(SAMPLES.length);
  await expect(page.locator("#examples-body")).not.toContainText("404");

  // And they open: the degraded browser is still a browser.
  const before = await page.locator("#app").getAttribute("src");
  await page.locator(`.example-row[data-sample="${SAMPLES[1].id}"]`).click();
  await expect(page.locator("#app")).not.toHaveAttribute("src", before ?? "", { timeout: 60000 });
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.frameLocator("#app").getByText(SAMPLES[1].title)).toBeVisible({ timeout: 30000 });

  // Nothing of ours reached the console. The one line that does appear is the
  // browser's own resource log for the 404 response - Chromium writes it for
  // every non-2xx fetch and no page code can prevent or catch it, which is
  // also why the catalogues are only fetched once the button is clicked.
  expect(errors.filter((text) => !text.includes("Failed to load resource"))).toEqual([]);
});

test("an index in a shape the browser does not know is skipped without a sound", async ({ page }) => {
  // A 200 that is not the index: JSON whose entries are not a list. Unlike the
  // 404 case there is no resource log line here, so this is where "zero
  // console errors" is checked whole.
  await page.route(INDEX_URL, (route) => route.fulfill(json({ entries: "not an array", controls: 7 })));

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await open(page);
  await openBrowser(page);

  await expect(page.locator(".examples-group")).toHaveText(["Your drafts", "In the page"]);
  expect(errors).toEqual([]);
});

test("the index is fetched once, however often the browser is opened", async ({ page }) => {
  // It is most of a megabyte, and nothing about it changes while the page is
  // open. The stored per-repository cache this replaced is gone with the three
  // foreign fetches: same origin, so the ordinary HTTP cache and the service
  // worker are what make the NEXT visit cheap, and neither needs a copy in
  // localStorage to do it.
  let hits = 0;
  await page.route(INDEX_URL, (route) => {
    hits += 1;
    return route.fulfill(json(APPS_INDEX));
  });

  await open(page);
  await openBrowser(page);
  expect(hits).toBe(1);

  // Closing and reopening costs nothing more.
  await page.keyboard.press("Escape");
  /* Waited for, not assumed. This test is about the index being FETCHED once,
   * and the close is only how it gets there - but a dialog that has not closed
   * yet is discovered by the next click, which Playwright then retries for the
   * full 120s against a <dialog> intercepting pointer events, and reports as
   * "click intercepted" with no hint that the Escape is what did not land.
   * That is not hypothetical: the app frame used to take focus away from the
   * modal as UI5 finished rendering, so the Escape went to the app's document
   * and the dialog stayed open (see the inert frame in
   * src/shell/examples.mjs). This line is what names that step when it
   * happens. */
  await expect(page.locator("#examples-dialog")).toBeHidden();
  await openBrowser(page);
  expect(hits).toBe(1);
  await expect(page.locator(".examples-group", { hasText: "Start here" })).toBeVisible();
});

test("the dialog links to the catalogue page, where a search has an address", async ({ page }) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);
  await expect(page.locator(".examples-all")).toHaveAttribute("href", "samples/");
});
