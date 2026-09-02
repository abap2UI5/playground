import { test, expect } from "@playwright/test";

test("the page loads clean", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await expect(page.locator(".brand")).toContainText("abap2UI5");
  // The runtime is 8 MB and boots asynchronously; the status line is the page
  // telling us it got there.
  await expect(page.locator("#status")).toContainText("running", { timeout: 90000 });

  expect(errors).toEqual([]);
});

test("the bar names the framework version it is running", async ({ page }) => {
  await page.goto("/");
  // Read out of the transpiled z2ui5_if_app=>version, so a wrong lookup shows
  // as "unknown" rather than as nothing at all.
  await expect(page.locator("#versions")).toHaveText(/^abap2UI5 \d+\.\d+\.\d+$/, { timeout: 90000 });
});

// The corpus the editor thinks with, as it is served. Two things are worth
// holding here rather than in the build: what has to be in it, and the one
// thing that must not.
test("the corpus carries the framework and leaves out its generated frontend", async ({ request }) => {
  const corpus = await (await request.get("/editor/corpus.json")).json();
  const names = Object.keys(corpus);

  // What the editor cannot answer anything without.
  expect(names).toContain("z2ui5_if_app.intf.abap");
  expect(names).toContain("z2ui5_cl_ui5_view_builder.clas.abap");
  expect(names.filter((n) => n.startsWith("cl_abap_"))).not.toHaveLength(0);

  // And what it must never carry again. abap2UI5's src/01/03 is its UI5
  // frontend generated into ABAP string constants for a real system to serve;
  // the playground builds the same frontend from source into dist/app and never
  // reads these. Each of them is one enormous concatenated statement, and
  // abaplint parses an expression with recursive combinators - so they took the
  // boot parse from 130 KB of JavaScript stack to over 610 KB, which is inside
  // what Chrome hands out and outside what mobile Safari does. The playground
  // started on every desk and on no phone. tools/check-size.mjs measures the
  // stack itself; this says which sources are allowed to be in the number.
  expect(names.filter((n) => n.startsWith("z2ui5_cl_ui5f_"))).toEqual([]);
});

// And the same directory stays out of the framework bundle, for the bytes this
// time: 62 classes holding the frontend's source as string constants, read by
// nothing the playground ever runs - see generatedFrontendStubPlugin in
// tools/esbuild-plugins.mjs. The marker is a line of the frontend's own
// JavaScript (core/Server.js), which only those classes carry as text.
//
// Asserted as booleans on purpose: a toContain( ) over a six-megabyte string
// prints the whole string when it fails.
test("the framework bundle leaves the generated frontend out as well", async ({ request }) => {
  const bundle = await (await request.get("/runtime/framework.mjs")).text();
  expect(bundle.includes("z2ui5.checkLocal"), "the generated frontend is in the bundle").toBe(false);
  // The classes are still there by name, so a reference to one fails with a
  // sentence rather than with "undefined".
  expect(bundle.includes("Z2UI5_CL_UI5F_PRELOAD"), "the stub for the generated frontend is missing").toBe(true);
  expect(bundle.includes("which the playground does not carry"), "the stub's message is missing").toBe(true);
});

// The framework runs in a worker of the page's, started by index.html before
// the shell bundle has arrived - so its evaluation, the better part of a second
// on a desk, overlaps the corpus parse instead of sitting in front of it. Both
// halves are held here: that the worker exists, and that the page itself never
// evaluated the bundle on its own thread.
test("the ABAP runtime runs in a worker, not on the page's thread", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 90000 });

  const workers = page.workers().map((w) => new URL(w.url()).pathname);
  expect(workers).toContain("/runtime/framework.mjs");
  // And so does the abaplint registry, whose corpus parse is the boot's
  // largest single cost - off the page's thread as well.
  expect(workers).toContain("/editor/registry.mjs");
  // The bundle registers the framework under globalThis.abap wherever it is
  // evaluated - so the page not having one is the page not having paid for it.
  expect(await page.evaluate(() => typeof globalThis.abap)).toBe("undefined");
});

test("a registry worker that will not start is reported, not waited for", async ({ page }) => {
  await page.route("**/editor/registry.mjs", (route) => route.fulfill({ status: 503, body: "" }));

  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("the playground could not start", { timeout: 90000 });
  // Named either by the browser's error event (Chromium does fire one for a
  // 503, with an empty message) or by the HEAD probe that stands in for it.
  await expect(page.locator(".log-body")).toContainText("editor/registry.mjs");
});

test("a runtime that will not start is reported, not waited for", async ({ page }) => {
  await page.route("**/runtime/framework.mjs", (route) => route.fulfill({ status: 503, body: "" }));

  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("the playground could not start", { timeout: 90000 });
  // Whatever the browser could say about a worker that never started, rather
  // than an empty line: a worker fails with an ErrorEvent, not an exception.
  await expect(page.locator(".log-body")).not.toBeEmpty();
});

test("a startup failure says what went wrong, not only where", async ({ page }) => {
  // The corpus is the one asset boot( ) cannot do without, so refusing it is
  // the shortest way to a real startup failure.
  await page.route("**/editor/corpus.json", (route) => route.fulfill({ status: 503, body: "" }));

  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("the playground could not start", { timeout: 90000 });

  // The message, not just the frames. This used to be String(e.stack), which
  // reads correctly in Chrome only because V8 puts the message at the top of a
  // stack - WebKit and Gecko do not, and there the whole report was minified
  // frames with nothing saying what had happened. See describeError( ) in
  // src/shell/ui.mjs.
  await expect(page.locator(".log-body")).toContainText("corpus.json: 503");
});
