import { test, expect } from "@playwright/test";
import { control, open, openFiles } from "./helpers.mjs";

// The examples browser: the sample repositories' committed catalogues, fetched
// when the Examples button is clicked, listed next to the built-in samples,
// and opened through the same path a ?src= link takes.
//
// The catalogues live on raw.githubusercontent.com, so every test intercepts
// that host - the success cases because a test must not depend on somebody
// else's repository state, and the failure cases because failing is exactly
// what is being staged. Nothing here ever reaches the real host.

const CATALOGUE_URL = {
  samples: "https://raw.githubusercontent.com/abap2UI5/samples/main/catalogue.json",
  controls: "https://raw.githubusercontent.com/abap2UI5/samples-controls/main/catalogue.json",
};

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

// The real catalogues' shapes, cut down: samples[] with a learning-path stage
// (abap2UI5/samples) and ports[] with entity, library and status
// (abap2UI5/samples-controls).
const SAMPLES_CATALOGUE = {
  repository: "abap2UI5/samples",
  learningPath: [
    { id: "start", title: "Start here", blurb: "Five apps in reading order." },
    { id: "rows", title: "Show many rows", blurb: "Internal tables on screen." },
  ],
  samples: [
    {
      class: "z2ui5_cl_smp_app_493",
      file: "src/01/z2ui5_cl_smp_app_493.clas.abap",
      category: "Basics",
      stage: "start",
      title: "Basics I",
      description: "Hello World, the Smallest App",
      keywords: ["hello", "world", "smallest"],
    },
    {
      class: "z2ui5_cl_smp_app_040",
      file: "src/01/z2ui5_cl_smp_app_040.clas.abap",
      category: "Table",
      stage: "rows",
      title: "Responsive Table I",
      description: "An internal table on screen",
      keywords: ["table", "rows"],
    },
  ],
};

const CONTROLS_CATALOGUE = {
  repo: "abap2UI5/samples-controls",
  ports: [
    {
      class: "z2ui5_cl_smpc_app_003",
      file: "src/01/01/z2ui5_cl_smpc_app_003.clas.abap",
      category: "src/01",
      library: "sap.m",
      sample: "sap.m.sample.Breadcrumbs",
      entity: "sap.m.Breadcrumbs",
      title: "Breadcrumbs",
      summary: "A trail of links back to where the user came from",
      keywords: "breadcrumbs sap.m link trail",
      status: "checked",
      deviations: [],
    },
    // SAPUI5-only: the src/03 collection must not be offered at all.
    {
      class: "z2ui5_cl_smpc_app_900",
      file: "src/03/z2ui5_cl_smpc_app_900.clas.abap",
      category: "src/03",
      library: "sap.ui.comp",
      entity: "sap.ui.comp.smarttable.SmartTable",
      title: "Smart Table",
      summary: "SAPUI5 only",
      status: "collection",
      deviations: [],
    },
    // A library the site does not carry: the control could never load, so the
    // entry must not be offered either.
    {
      class: "z2ui5_cl_smpc_app_901",
      file: "src/02/z2ui5_cl_smpc_app_901.clas.abap",
      category: "src/02",
      library: "sap.viz",
      entity: "sap.viz.ui5.controls.VizFrame",
      title: "Viz Chart",
      summary: "needs sap.viz",
      status: "reviewed",
      deviations: [],
    },
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
  await page.route(CATALOGUE_URL.samples, (route) => route.fulfill(json(SAMPLES_CATALOGUE)));
  await page.route(CATALOGUE_URL.controls, (route) => route.fulfill(json(CONTROLS_CATALOGUE)));
  await page.route("https://raw.githubusercontent.com/abap2UI5/samples/main/src/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      headers: CORS,
      body: catalogueAbap(route.request().url().split("/").pop().replace(".clas.abap", "")),
    }),
  );
}

// Opens the browser and waits until both catalogues have answered - the
// "looking…" line leaving is the module saying it is done loading.
async function openBrowser(page) {
  await page.locator("#examples").click();
  await expect(page.locator("#examples-dialog")).toBeVisible();
  await expect(page.locator("#examples-body")).not.toContainText("looking in the sample repositories", {
    timeout: 30000,
  });
}

test("the catalogues are listed by learning-path stage, and an entry runs through the ?src= path", async ({
  page,
}) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  // The built-ins first, then the samples repository in reading order, then
  // the controls grouped by library.
  await expect(page.locator(".examples-group").first()).toHaveText("Built in");
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

  // And the sample menu no longer claims the editor holds one of its samples.
  await expect(page.locator("#samples")).toHaveValue("");
});

test("the search narrows the list across every group", async ({ page }) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  // A controls keyword: only that port stays, the samples and built-ins go.
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

test("entries the playground cannot run are not offered", async ({ page }) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);

  // The port that runs is there; the SAPUI5-only collection entry and the port
  // whose library is not built into the site are not - offering either would
  // be offering a control that cannot load.
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_003" })).toBeVisible();
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_900" })).toHaveCount(0);
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_901" })).toHaveCount(0);
});

test("without the catalogues the browser degrades to the built-in samples, quietly", async ({ page }) => {
  // Today's normal case: the catalogues' pull requests are open, main answers
  // 404. The browser keeps working on what is always here.
  for (const url of Object.values(CATALOGUE_URL)) {
    await page.route(url, (route) =>
      route.fulfill({ status: 404, contentType: "text/plain", headers: CORS, body: "404: Not Found" }),
    );
  }

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await open(page);
  await openBrowser(page);

  // Only the built-ins - all nine of them, searchable - and not a word about
  // what could not be fetched.
  await expect(page.locator(".examples-group")).toHaveText(["Built in"]);
  await expect(page.locator(".example-row")).toHaveCount(9);
  await expect(page.locator("#examples-body")).not.toContainText("404");

  // And they open: the degraded browser is still a browser.
  const before = await page.locator("#app").getAttribute("src");
  await page.locator(".example-row", { hasText: "Counter" }).click();
  await expect(page.locator("#app")).not.toHaveAttribute("src", before ?? "", { timeout: 60000 });
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(control(page, "txtCount")).toBeVisible();

  // Nothing of ours reached the console. The one line that does appear is the
  // browser's own resource log for the 404 response - Chromium writes it for
  // every non-2xx fetch and no page code can prevent or catch it, which is
  // also why the catalogues are only fetched once the button is clicked.
  expect(errors.filter((text) => !text.includes("Failed to load resource"))).toEqual([]);
});

test("a catalogue in a shape the browser does not know is skipped without a sound", async ({ page }) => {
  // A 200 that is not a catalogue: an HTML error page served as 200, and a
  // JSON whose entries are missing. Unlike the 404 case there is no resource
  // log line here, so this is where "zero console errors" is checked whole.
  await page.route(CATALOGUE_URL.samples, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", headers: CORS, body: "<!doctype html>not json" }),
  );
  await page.route(CATALOGUE_URL.controls, (route) => route.fulfill(json({ ports: "not an array" })));

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await open(page);
  await openBrowser(page);

  await expect(page.locator(".examples-group")).toHaveText(["Built in"]);
  expect(errors).toEqual([]);
});

test("a fetched catalogue is served from the stored copy for a day", async ({ page }) => {
  const hits = { samples: 0, controls: 0 };
  await page.route(CATALOGUE_URL.samples, (route) => {
    hits.samples += 1;
    return route.fulfill(json(SAMPLES_CATALOGUE));
  });
  await page.route(CATALOGUE_URL.controls, (route) => {
    hits.controls += 1;
    return route.fulfill(json(CONTROLS_CATALOGUE));
  });

  await open(page);
  await openBrowser(page);
  expect(hits).toEqual({ samples: 1, controls: 1 });

  // Closing and reopening in the same page costs nothing more...
  await page.keyboard.press("Escape");
  /* Waited for, not assumed. This test is about the catalogue being FETCHED
   * once, and the close is only how it gets there - but without this line a
   * dialog that has not closed yet is discovered by the next click, which
   * Playwright then retries for the full 120s against a <dialog> intercepting
   * pointer events, and reports as "click intercepted" with no hint that the
   * Escape is what did not land. Seen once in a full run and not reproducible
   * since (three clean runs, isolated and whole-file). If it comes back, this
   * fails in one second and names the actual step. */
  await expect(page.locator("#examples-dialog")).toBeHidden();
  await openBrowser(page);
  expect(hits).toEqual({ samples: 1, controls: 1 });

  // ...and neither does the next visit: the copy in localStorage answers.
  await open(page);
  await openBrowser(page);
  await expect(page.locator(".examples-group", { hasText: "Start here" })).toBeVisible();
  expect(hits).toEqual({ samples: 1, controls: 1 });
});
