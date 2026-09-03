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
  stack: "https://raw.githubusercontent.com/abap2UI5/samples-stack/main/catalogue.json",
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

// abap2UI5/samples-stack: samples[] on delivery branches of their own, none of
// which runs without a system - listed for finding, opened for reading.
const STACK_CATALOGUE = {
  repo: "abap2UI5/samples-stack",
  samples: [
    {
      class: "Z2UI5_CL_SMPS_APP_314",
      path: "src/02/z2ui5_cl_smps_app_314.clas.abap",
      package: "src/02",
      technology: "Smart Controls",
      title: "Switch Default Model",
      summary: "device, HTTP and OData model side by side",
      keywords: ["odata", "model", "smart"],
      needs: "SAPUI5 + an activated Gateway service",
      branch: "02-smart-controls",
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
  await page.route(CATALOGUE_URL.stack, (route) => route.fulfill(json(STACK_CATALOGUE)));
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

  // The reader's own drafts first (none yet, but the row that saves one),
  // then the built-ins, then the samples repository in reading order, then
  // the controls grouped by library.
  await expect(page.locator(".examples-group").first()).toHaveText("Your drafts");
  await expect(page.locator(".examples-group").nth(1)).toHaveText("Built in");
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
  // entry, the port whose library is not built into the site and the stack
  // sample are there too, each saying what it needs and disabled - this
  // browser is where the repositories' own pages used to be, and a sample
  // somebody cannot find is worse than one they cannot run.
  const runs = page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_003" });
  await expect(runs).toBeVisible();
  await expect(runs).toBeEnabled();
  await expect(runs.locator(".example-needs")).toHaveCount(0);
  const sapui5 = page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_900" });
  await expect(sapui5.locator(".example-needs")).toHaveText("needs SAPUI5");
  await expect(sapui5).toBeDisabled();
  // sap.viz is a library only SAPUI5 carries, so that port says SAPUI5 rather
  // than the library: the reader's question is which runtime, not which jar.
  const viz = page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_901" });
  await expect(viz.locator(".example-needs")).toHaveText("needs SAPUI5");
  await expect(viz).toBeDisabled();
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
  await expect(page.locator(".example-item[data-sample], .example-item", { has: page.locator("[data-sample]") }).first().locator(".example-github")).toHaveAttribute("href", /playground/);

  // The filters cut them away: "OpenUI5 only" takes the SAPUI5 ones (the
  // stack sample names SAPUI5 too), the Stack box the stack - and what was
  // ticked is remembered for the next open.
  await page.locator('input[data-filter="openui5only"]').check();
  await expect(sapui5).toHaveCount(0);
  await expect(viz).toHaveCount(0);
  await expect(stack).toHaveCount(0);
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

test("the release filter hides what needs a UI5 newer than 1.71", async ({ page }) => {
  await serveCatalogues(page);
  await open(page);
  await openBrowser(page);
  // src/01 runs on 1.71 and stays; src/02 needs a newer UI5 and goes.
  await page.locator('input[data-filter="newer"]').uncheck();
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_003" })).toBeVisible();
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_901" })).toHaveCount(0);
  // The built-ins stay whatever the boxes say: they are the page's own.
  await expect(page.locator(".example-row[data-sample]").first()).toBeVisible();
  await page.locator('input[data-filter="newer"]').check();
  await expect(page.locator(".example-row", { hasText: "z2ui5_cl_smpc_app_901" })).toBeVisible();
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

  // Only the drafts' row and the built-ins - all nine of them, searchable -
  // and not a word about what could not be fetched.
  await expect(page.locator(".examples-group")).toHaveText(["Your drafts", "Built in"]);
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
  await page.route(CATALOGUE_URL.stack, (route) => route.fulfill(json({ samples: { not: "an array" } })));

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await open(page);
  await openBrowser(page);

  await expect(page.locator(".examples-group")).toHaveText(["Your drafts", "Built in"]);
  expect(errors).toEqual([]);
});

test("a fetched catalogue is served from the stored copy for a day", async ({ page }) => {
  const hits = { samples: 0, controls: 0, stack: 0 };
  await page.route(CATALOGUE_URL.samples, (route) => {
    hits.samples += 1;
    return route.fulfill(json(SAMPLES_CATALOGUE));
  });
  await page.route(CATALOGUE_URL.controls, (route) => {
    hits.controls += 1;
    return route.fulfill(json(CONTROLS_CATALOGUE));
  });
  await page.route(CATALOGUE_URL.stack, (route) => {
    hits.stack += 1;
    return route.fulfill(json(STACK_CATALOGUE));
  });

  await open(page);
  await openBrowser(page);
  expect(hits).toEqual({ samples: 1, controls: 1, stack: 1 });

  // Closing and reopening in the same page costs nothing more...
  await page.keyboard.press("Escape");
  /* Waited for, not assumed. This test is about the catalogue being FETCHED
   * once, and the close is only how it gets there - but a dialog that has not
   * closed yet is discovered by the next click, which Playwright then retries
   * for the full 120s against a <dialog> intercepting pointer events, and
   * reports as "click intercepted" with no hint that the Escape is what did
   * not land. That is not hypothetical: the app frame used to take focus away
   * from the modal as UI5 finished rendering, so the Escape went to the app's
   * document and the dialog stayed open (see the inert frame in
   * src/shell/examples.mjs). This line is what names that step when it
   * happens. */
  await expect(page.locator("#examples-dialog")).toBeHidden();
  await openBrowser(page);
  expect(hits).toEqual({ samples: 1, controls: 1, stack: 1 });

  // ...and neither does the next visit: the copy in localStorage answers.
  await open(page);
  await openBrowser(page);
  await expect(page.locator(".examples-group", { hasText: "Start here" })).toBeVisible();
  expect(hits).toEqual({ samples: 1, controls: 1, stack: 1 });
});
