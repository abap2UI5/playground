import { test, expect } from "@playwright/test";
import { getSource, open, pickSample, setSource } from "./helpers.mjs";

// Named drafts, in the samples browser - see src/shell/drafts.mjs.

const MARKER = "kept as a named draft";

test("a draft saved under a name comes back another day, and can be deleted", async ({ page }) => {
  await open(page);
  await setSource(page, (await getSource(page)).replace("Hello abap2UI5", MARKER));

  // Named and saved from the samples browser.
  await page.locator("#examples").click();
  await expect(page.locator("#examples-body")).toContainText("Nothing saved yet");
  await page.locator(".drafts-name").fill("my greeting");
  await page.locator(".drafts-save-button").click();
  const row = page.locator('.example-row[data-draft="my greeting"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText("zcl_playground.clas.abap");
  await page.keyboard.press("Escape");

  // Replaced by a sample, then brought back from the list - and it runs.
  await pickSample(page, "counter");
  await expect(page.locator("#status")).toHaveText(/running/, { timeout: 60000 });
  expect(await getSource(page)).not.toContain(MARKER);
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
