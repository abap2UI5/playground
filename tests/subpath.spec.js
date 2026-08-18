import { test, expect } from "@playwright/test";

// GitHub Pages serves a project site under /<repo>/, so every URL the page
// builds has to be relative to the document rather than to the origin. This is
// the one thing that cannot be found by looking at the page at the root: it
// works there either way.

test("the playground works when it is not at the site root", async ({ page }) => {
  const missing = [];
  page.on("response", (r) => {
    if (r.status() === 404) missing.push(r.url());
  });

  await page.goto("/under-a-subpath/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  // The framework, the corpus, the UI5 frame and everything in it resolved
  // against the document, not against the origin.
  await expect(page.frameLocator("#app").getByText("Hello abap2UI5")).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("src", /\/under-a-subpath\/app\/index\.html/);
  expect(missing).toEqual([]);

  // And it still runs: the roundtrip goes to the frame's own path, which is
  // now a longer one.
  await page.frameLocator("#app").locator('[id$="--inpName-inner"]').fill("Subpath");
  await page.frameLocator("#app").locator('[id$="--btnGreet"]').click();
  await expect(page.frameLocator("#app").locator('[id$="--txtGreeting"]')).toContainText("Hello Subpath!");
});
