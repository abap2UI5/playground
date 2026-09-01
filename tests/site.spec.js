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
