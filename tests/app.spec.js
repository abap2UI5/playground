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

test("the frontend says something useful when opened without the playground", async ({ page }) => {
  await page.goto("/app/index.html?app_start=ZCL_PLAYGROUND");

  // UI5 boots, the first roundtrip has nowhere to go, and the frontend's own
  // error view carries the explanation - not a TypeError about a missing
  // property on window.parent.
  await expect(page.getByText("no backend of its own")).toBeVisible({ timeout: 60000 });
});
