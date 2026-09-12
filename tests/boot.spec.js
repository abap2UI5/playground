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

test("the app frame says what is happening while the runtime boots, and gets out of the way once it runs", async ({ page }) => {
  // The right half used to be a blank frame for the whole boot - seconds on a
  // desk, fourteen throttled - with the only sign of life a small status line
  // in the toolbar. Held back the same way the test above holds the corpus, so
  // the placeholder is on screen long enough to be read.
  await page.route("**/editor/corpus.json", async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  await page.goto("/");

  const placeholder = page.locator("#app-placeholder");
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toContainText("Your app renders here");
  // The same progress the toolbar's status line carries, in the frame the
  // visitor is looking at.
  await expect(page.locator("#app-placeholder-status")).not.toHaveText("running");
  await expect(page.locator("#app-placeholder-status")).toContainText(/sources|runtime|starting/);
  // And the way to the dialog that says what this is and where it stops.
  await placeholder.getByRole("button", { name: /where it stops/ }).click();
  await expect(page.locator("#about-dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(placeholder).toBeHidden();
});

test("? opens the About dialog - except where a question mark is a character", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  const dialog = page.locator("#about-dialog");
  // In the editor it is typed, not obeyed.
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("Shift+?");
  await expect(dialog).toBeHidden();

  // On the page itself it opens the dialog.
  await page.locator("#status").click();
  await page.keyboard.press("Shift+?");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Where it stops");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
