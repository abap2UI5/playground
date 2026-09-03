import { test, expect } from "@playwright/test";
import { control, open } from "./helpers.mjs";

// The playground as a user meets it: the class in the editor is compiled and
// started, it renders in the frame, and clicking something in it runs ABAP.

test("the class in the editor renders as an app", async ({ page }) => {
  await open(page);

  // The title comes out of the ABAP view builder, travels as XML through the
  // roundtrip, and is rendered by UI5 - so seeing it means the whole chain works.
  await expect(page.frameLocator("#app").getByText("Hello abap2UI5")).toBeVisible();
  await expect(control(page, "inpName", "-inner")).toHaveValue("World");
});

test("a click in the app runs ABAP and updates the view", async ({ page }) => {
  await open(page);

  await control(page, "inpName", "-inner").fill("Playground");
  await control(page, "btnGreet").click();

  // Computed in ABAP from the value the input pushed over, and pushed back
  // into the model automatically.
  await expect(control(page, "txtGreeting")).toContainText("Hello Playground!", { timeout: 30000 });
});

test("Run restarts the app from scratch", async ({ page }) => {
  await open(page);

  await control(page, "inpName", "-inner").fill("Changed");
  await control(page, "btnGreet").click();
  await expect(control(page, "txtGreeting")).toContainText("Hello Changed!");

  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running");

  await expect(control(page, "inpName", "-inner")).toHaveValue("World");
  await expect(control(page, "txtGreeting")).toHaveText("");
});

test("a run loads only from this origin, and nothing 404s", async ({ page }) => {
  const external = [];
  const missing = [];
  await page.route("**", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://localhost:8080") external.push(url.href);
    return route.continue();
  });
  page.on("response", (r) => {
    if (r.status() === 404) missing.push(r.url());
  });

  await open(page);
  await expect(page.frameLocator("#app").getByText("Hello abap2UI5")).toBeVisible();

  expect(external, "the playground must work without a CDN").toEqual([]);
  expect(missing, "a 404 means the build left something out").toEqual([]);
});

// The frame's first load is fetched into the cache while the corpus parses,
// by the page rather than by the frame - see src/shell/warm-up.mjs. What is
// held here is that the page asks, for the right URLs (the stylesheets with
// the query UI5 puts on them), and before Run could have. Whether the frame
// then finds them in the cache is the server's caching headers' business:
// GitHub Pages answers with a max-age, the test server on purpose does not.
test("the page warms the app frame's first load while the corpus parses", async ({ page }) => {
  // Every request for something under app/, in the order the browser made
  // them, and who asked: the page (the warm-up) or the frame (UI5 itself).
  const asked = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!url.pathname.includes("/app/")) return;
    asked.push({ byPage: r.frame() === page.mainFrame(), path: url.pathname + url.search });
  });

  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  const firstByFrame = asked.findIndex((a) => !a.byPage);
  expect(firstByFrame, "the frame loaded something").toBeGreaterThan(0);
  const warmed = asked.slice(0, firstByFrame).map((a) => a.path);
  // Everything the page asked for, it asked for before the frame existed.
  expect(asked.slice(firstByFrame).filter((a) => a.byPage)).toEqual([]);

  expect(warmed).toContain("/app/resources/sap-ui-core.js");
  expect(warmed).toContain("/app/resources/sap/m/library-preload.js");
  expect(warmed.some((p) => /^\/app\/resources\/sap\/m\/themes\/sap_horizon\/library\.css\?sap-ui-dist-version=\d/.test(p))).toBe(true);
  // And every one of them is a file the build produced - a warm-up of a URL
  // that 404s would be a request for nothing on every visit.
  const answers = await Promise.all(warmed.map((p) => page.request.get(p).then((r) => `${r.status()} ${p}`)));
  expect(answers.filter((a) => !a.startsWith("200 "))).toEqual([]);
});

test("the frontend says something useful when opened without the playground", async ({ page }) => {
  await page.goto("/app/index.html?app_start=ZCL_PLAYGROUND");

  // UI5 boots, the first roundtrip has nowhere to go, and the frontend's own
  // error view carries the explanation - not a TypeError about a missing
  // property on window.parent.
  await expect(page.getByText("no backend of its own")).toBeVisible({ timeout: 60000 });
});
