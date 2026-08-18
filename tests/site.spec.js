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
