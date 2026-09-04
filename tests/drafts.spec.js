import { test, expect } from "@playwright/test";
import { getSource, MAIN_FILE, MAIN_MARK, open, pickSample, SAMPLES, setSource } from "./helpers.mjs";

// A sample other than the one the page opens on, to replace the draft with.
const OTHER = SAMPLES[1];

// Named drafts, in the samples browser - see src/shell/drafts.mjs.

const MARKER = "kept as a named draft";

test("a draft saved under a name comes back another day, and can be deleted", async ({ page }) => {
  await open(page);
  await setSource(page, (await getSource(page)).replace(MAIN_MARK, MARKER));

  // Named and saved from the samples browser.
  await page.locator("#examples").click();
  await expect(page.locator("#examples-body")).toContainText("Nothing saved yet");
  await page.locator(".drafts-name").fill("my greeting");
  await page.locator(".drafts-save-button").click();
  const row = page.locator('.example-row[data-draft="my greeting"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText(MAIN_FILE);
  await page.keyboard.press("Escape");

  // Replaced by a sample, then brought back from the list - and it runs.
  await pickSample(page, OTHER.id);
  await expect(page.locator("#status")).toHaveText(/running/, { timeout: 60000 });
  expect(await getSource(page, OTHER.files[0])).not.toContain(MARKER);
  await page.locator("#examples").click();
  await row.click();
  await expect(page.locator("#status")).toHaveText(/running/, { timeout: 60000 });
  expect(await getSource(page)).toContain(MARKER);
  await expect(page.frameLocator("#app").getByText(MARKER)).toBeVisible();

  // Another day: still there.
  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await page.locator("#examples").click();
  await expect(row).toBeVisible();

  // Saving under the same name replaces, not doubles.
  await page.locator(".drafts-name").fill("my greeting");
  await page.locator(".drafts-save-button").click();
  await expect(page.locator('.example-row[data-draft="my greeting"]')).toHaveCount(1);

  // A name is required, and says so.
  await page.locator(".drafts-name").fill("   ");
  await page.locator(".drafts-save-button").click();
  await expect(page.locator("#examples-body")).toContainText("Give the draft a name");

  // Deleted where it is listed.
  await page.locator('[aria-label="Delete the draft my greeting"]').click();
  await expect(row).toHaveCount(0);
  await expect(page.locator("#examples-body")).toContainText("Nothing saved yet");
});
