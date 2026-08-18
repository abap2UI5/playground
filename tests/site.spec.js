import { test, expect } from "@playwright/test";

test("the site is served and loads without console errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await expect(page.locator("h1")).toContainText("abap2UI5");
  expect(errors).toEqual([]);
});
