import { test, expect } from "@playwright/test";

// The window between the editor appearing and the registry existing. It is
// short on a fast connection and several seconds on a slow one, and the editor
// is typeable throughout it - so everything that reacts to a change has to
// survive being called before there is anything to check against.

test("typing before the corpus has been parsed does not throw, and the page still starts", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Holds the corpus back so the window is wide enough to type into on
  // purpose rather than by luck.
  await page.route("**/editor/corpus.json", async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  });

  await page.goto("/");
  await page.waitForFunction(() => window.monaco?.editor?.getModels?.().length > 0, null, { timeout: 60000 });
  await expect(page.locator("#status")).not.toHaveText("running");

  await page.evaluate(() => {
    const model = window.monaco.editor.getModels()[0];
    model.setValue(`${model.getValue()}\n* typed while the page was still starting\n`);
  });
  // Past the editor's 150 ms debounce, which is what actually calls out.
  await page.waitForTimeout(600);
  expect(errors).toEqual([]);

  // And the corpus still lands on top of the edit rather than under it.
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await page.evaluate(() => window.monaco.editor.getModels()[0].getValue())).toContain(
    "typed while the page was still starting",
  );
});
