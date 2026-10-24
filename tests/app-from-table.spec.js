import { test, expect } from "@playwright/test";
import { MAIN_FILE, getSource, open, openFiles } from "./helpers.mjs";

// "→ App" (src/editor/app-from-table.mjs): with a table on screen, the strip
// writes an app for it - a list of the rows and a dialog to add, change and
// delete one - puts it first, so Run starts it, and runs it. The app is held
// to what any app here is held to: abaplint and the linter find nothing, and
// it does what it says on the rows of the table's own seed file.

test("→ App writes an app for the table on screen, and it lists, adds, changes and deletes rows", async ({ page }) => {
  await open(page);
  await expect(page.locator(".file-app-from")).toHaveCount(0);

  await page.locator(".file-add-table").click();
  // Offered while the table - or its rows - is the file on screen.
  await expect(page.locator(".file-app-from")).toBeVisible();
  await page.locator(".file-app-from").click();

  expect(await openFiles(page)).toEqual(["zcl_zproducts_app.clas.abap", "zproducts.tabl.xml", "zproducts.tabu.json"]);
  expect(await getSource(page, "zcl_zproducts_app.clas.abap")).toContain("SELECT * FROM zproducts INTO TABLE @mt_rows");
  // Running - and, since "+ table" made the set somebody's work, saying where
  // that work went, as picking a sample over it does.
  await expect(page.locator("#status")).toContainText(/^running/, { timeout: 60000 });
  await expect(page.locator("#status")).toContainText("Your drafts");

  // Nothing to complain about: neither abaplint nor the linter.
  await page.locator('[data-insight="problems"]').click();
  await expect(page.locator("#problem-count")).not.toHaveClass(/is-error/);
  await expect(page.locator("#problem-count")).not.toHaveClass(/is-warning/);

  const frame = page.frameLocator("#app");
  const rows = frame.locator("tbody tr.sapMListTblRow:not(.sapMListTblHeader)");
  await expect(rows).toHaveCount(5, { timeout: 30000 });
  await expect(rows.first()).toContainText("Notebook 14");

  // Add: a dialog with one input per field, the key open on a new row.
  await frame.getByRole("button", { name: "Add" }).click();
  const dialog = frame.locator(".sapMDialog");
  await expect(dialog).toBeVisible({ timeout: 30000 });
  const inputs = dialog.locator("input");
  await inputs.nth(0).fill("P006");
  await inputs.nth(1).fill("Webcam");
  await inputs.nth(2).fill("Accessories");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(rows).toHaveCount(6, { timeout: 30000 });
  await expect(frame.locator("table")).toContainText("Webcam");

  // Change: the dialog opens on the row, its key fixed.
  await rows.nth(1).locator("button").first().click();
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await expect(inputs.nth(0)).toHaveValue("P002");
  await expect(inputs.nth(0)).not.toBeEditable();
  await inputs.nth(1).fill("Monitor 32");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(rows.nth(1)).toContainText("Monitor 32", { timeout: 30000 });

  // Delete.
  await rows.nth(0).locator("button").nth(1).click();
  await expect(rows).toHaveCount(5, { timeout: 30000 });
  await expect(frame.locator("table")).not.toContainText("Notebook 14");
});

test("what was there before the app is kept, as with a sample picked over it", async ({ page }) => {
  await open(page);
  await page.locator(".file-add-table").click();
  await page.locator(".file-app-from").click();
  await expect(page.locator("#status")).toContainText(/zcl_zproducts_app|draft/, { timeout: 60000 });
  // The class that was first is not in the new set: it went where a
  // replaced draft goes, and the status line says so (or it was the
  // untouched starter, which needs no keeping).
  expect(await openFiles(page)).not.toContain(MAIN_FILE);
});
