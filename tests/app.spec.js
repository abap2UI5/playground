import { test, expect } from "@playwright/test";

// The playground as a user meets it: open the page, the app renders in the
// frame, clicking something in it runs ABAP and changes what is on screen.

// UI5 prefixes every control id with the id of the view that holds it
// (`mainView--btnGreet`), so the tests match on the suffix - the part the ABAP
// actually chose.
const byControl = (page, id, suffix = "") =>
  page.frameLocator("#app").locator(`[id$="--${id}${suffix}"]`);

async function open(page) {
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("running ZCL_PG_HELLO", { timeout: 90000 });
}

test("the built-in app renders in the frame", async ({ page }) => {
  await open(page);

  // The title comes out of the ABAP view builder, travels as XML through the
  // roundtrip, and is rendered by UI5 - so seeing it means the whole chain works.
  await expect(page.frameLocator("#app").getByText("abap2UI5 Playground")).toBeVisible();
  await expect(byControl(page, "inpName", "-inner")).toHaveValue("World");
});

test("a click in the app runs ABAP and updates the view", async ({ page }) => {
  await open(page);

  await byControl(page, "inpName", "-inner").fill("Playground");
  await byControl(page, "btnGreet").click();

  // Computed in ABAP from the value the input pushed over, and pushed back
  // into the model automatically.
  await expect(byControl(page, "txtGreeting")).toContainText("Hello Playground!", { timeout: 30000 });
});

test("Run restarts the app from scratch", async ({ page }) => {
  await open(page);

  await byControl(page, "inpName", "-inner").fill("Changed");
  await byControl(page, "btnGreet").click();
  await expect(byControl(page, "txtGreeting")).toContainText("Hello Changed!");

  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("running ZCL_PG_HELLO");

  await expect(byControl(page, "inpName", "-inner")).toHaveValue("World");
  await expect(byControl(page, "txtGreeting")).toHaveText("");
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
  await expect(page.frameLocator("#app").getByText("abap2UI5 Playground")).toBeVisible();

  expect(external, "the playground must work without a CDN").toEqual([]);
  expect(missing, "a 404 means the build left something out").toEqual([]);
});

test("the frontend says something useful when opened without the playground", async ({ page }) => {
  await page.goto("/app/index.html?app_start=ZCL_PG_HELLO");

  // UI5 boots, the first roundtrip has nowhere to go, and the frontend's own
  // error view carries the explanation - not a TypeError about a missing
  // property on window.parent.
  await expect(page.getByText("no backend of its own")).toBeVisible({ timeout: 60000 });
});
