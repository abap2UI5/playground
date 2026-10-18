import { test, expect } from "@playwright/test";
import { getSource, MAIN_FILE, MAIN_MARK, open, setSource } from "./helpers.mjs";

// Compare with the original, and Reset to it (src/shell/original.mjs,
// src/shell/compare-dialog.mjs, showDiff( ) in src/editor/monaco-editor.mjs):
// over files that were opened from something - here the sample the page opens
// on - the bar offers the diff against the text as it was opened and a way
// back to it that is one Ctrl+Z away.

test("Compare and Reset wait for a change, then diff it and take it back as one undoable edit", async ({ page }) => {
  await open(page);
  const original = await getSource(page);
  const compare = page.locator("#compare");
  const reset = page.locator("#reset-original");

  // Opened and not changed: nothing to compare yet, and the title says why.
  await expect(compare).toBeDisabled();
  await expect(reset).toBeDisabled();
  await expect(compare).toHaveAttribute("title", /nothing changed/);

  const edited = original.replace(MAIN_MARK, `${MAIN_MARK} - edited`);
  await setSource(page, edited);
  await expect(compare).toBeEnabled();
  await expect(reset).toBeEnabled();

  // Monaco's diff editor, in the dialog, over the file on screen - and a
  // diff it actually computed: the page gives Monaco no worker, and the
  // diff editor waiting on one showed two panes and no difference.
  await compare.click();
  const dialog = page.locator("#compare-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#compare-file")).toHaveValue(MAIN_FILE);
  await expect(dialog.locator(".monaco-diff-editor")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.monaco.editor.getDiffEditors().at(-1)?.getLineChanges()?.length ?? 0))
    .toBe(1);
  // Opened on that change, which is drawn: the class is longer than the dialog.
  await expect(dialog.locator(".char-insert").first()).toBeVisible({ timeout: 10000 });
  // Read-only, both sides: typing in it changes nothing.
  await dialog.locator(".modified-in-monaco-diff-editor .view-lines").click();
  await page.keyboard.type("typed");
  expect(await getSource(page)).toBe(edited);
  // Closing it takes its scratch model with it - only the open files remain.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.monaco.editor.getModels().filter((m) => m.uri.scheme !== "file").length)).toBe(0);

  // Reset from the dialog: the original back, said, and undoable.
  await compare.click();
  await page.locator("#compare-reset").click();
  await expect(dialog).toBeHidden();
  expect(await getSource(page)).toBe(original);
  await expect(page.locator("#status")).toContainText("Ctrl+Z takes it back");
  await expect(compare).toBeDisabled();

  await page.locator("#undo").click();
  await expect.poll(() => getSource(page)).toBe(edited);
  await expect(compare).toBeEnabled();

  // And from the bar, the same.
  await reset.click();
  expect(await getSource(page)).toBe(original);
});

test("Over a restored draft there is no original, and the buttons say so", async ({ page }) => {
  test.slow();
  await open(page);
  const edited = (await getSource(page)).replace(MAIN_MARK, `${MAIN_MARK} - my own`);
  await setSource(page, edited);
  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 90000 });
  expect(await getSource(page)).toBe(edited);
  await expect(page.locator("#compare")).toBeDisabled();
  await expect(page.locator("#reset-original")).toBeDisabled();
  await expect(page.locator("#compare")).toHaveAttribute("title", /nothing to compare with/);
});

test("on a phone Compare and Reset are in the toolbar's menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await open(page);
  const original = await getSource(page);
  await setSource(page, original.replace(MAIN_MARK, `${MAIN_MARK} - phone`));
  await page.locator("#toolbar-more").click();
  await expect(page.locator("#toolbar-menu #compare")).toHaveText("Compare with original", { useInnerText: true });
  await expect(page.locator("#toolbar-menu #reset-original")).toBeVisible();
  await page.locator("#toolbar-menu #compare").click();
  await expect(page.locator("#compare-dialog .monaco-diff-editor")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("#toolbar-more").click();
  await page.locator("#toolbar-menu #reset-original").click();
  expect(await getSource(page)).toBe(original);
});
