import { test, expect } from "@playwright/test";
import { open, setSource, getSource } from "./helpers.mjs";

// The playground's own documents carry a Content-Security-Policy
// (playgroundPolicy( ) in tools/html.mjs). A policy that is too narrow does
// not fail loudly - a worker that will not start, a fetch refused, a style
// dropped - so this listens for the browser's own report of a violation
// through everything that loads or runs code: boot, Run, an error and its
// rename offer, the debugger, the samples dialog, and the two AI pages.
async function listen(page) {
  const seen = [];
  await page.exposeFunction("__cspViolation", (v) => seen.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolation(`${e.violatedDirective} ${e.blockedURI} (${e.sourceFile}:${e.lineNumber})`);
    });
  });
  return seen;
}

test("the workbench runs, checks and debugs under its policy", async ({ page }) => {
  const seen = await listen(page);
  await open(page);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  const source = await getSource(page);
  await setSource(page, source.replace("name = `World`.", "name = `World`.\n      BREAK-POINT."));
  await page.locator("#run").click();
  await expect(page.locator("html")).toHaveAttribute("data-debugger", "stopped", { timeout: 60000 });
  await page.keyboard.press("F8");
  await page.locator("#examples").click();
  await expect(page.locator("#examples-dialog")).toBeVisible();
  await expect(page.locator(".example-row").first()).toBeVisible({ timeout: 30000 });
  expect(seen).toEqual([]);
});

for (const path of ["ai/", "pilot/"]) {
  test(`/${path} starts under its policy`, async ({ page }) => {
    const seen = await listen(page);
    await page.goto(`/${path}`);
    await expect(page.locator("#status")).toHaveText(/^(ready|running)/, { timeout: 120000 });
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    if (path === "ai/") {
      await page.getByRole("button", { name: "Watch an example - no key needed" }).click();
      await expect(page.frameLocator("#app").getByText("Describe an app")).toBeVisible({ timeout: 60000 });
    }
    expect(seen).toEqual([]);
  });
}
