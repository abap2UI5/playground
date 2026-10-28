import { test, expect } from "@playwright/test";
import { markers, openFiles } from "./helpers.mjs";

// A classic report in the editor: the Run converts it with report2cloud of
// abap-cloud-gui (src/shell/report2cloud.mjs) and starts the class that came
// out of it on the addon's report runtime - the report stays what is edited.

const frame = (page) => page.frameLocator("#app");

test("a linked report is converted on Run, and its list comes after Execute", async ({ page }) => {
  await page.goto("/?src=examples/zr2c_linked_report.prog.abap");
  await expect(page.locator("#status")).toHaveText(/^running/, { timeout: 120000 });

  // The report is what is open - the class is what runs.
  expect(await openFiles(page)).toEqual(["zr2c_linked_report.prog.abap"]);
  await expect(page.locator(".log-body")).toContainText("ZR2C_LINKED_REPORT → zcl_r2c_linked_report");
  await expect(frame(page).getByText("ZCL_R2C_LINKED_REPORT").first()).toBeVisible({ timeout: 60000 });

  await frame(page).getByText("Execute").first().click();
  await expect(frame(page).getByText("converted in the browser")).toBeVisible({ timeout: 60000 });
});

test("the text pool beside a report gives the selection screen its texts", async ({ page }) => {
  await page.goto("/?src=examples/zr2c_linked_report.prog.abap&src=examples/zr2c_linked_report.prog.xml");
  await expect(page.locator("#status")).toHaveText(/^running/, { timeout: 120000 });

  expect(await openFiles(page)).toEqual(["zr2c_linked_report.prog.abap", "zr2c_linked_report.prog.xml"]);
  await expect(frame(page).getByText("Your name").first()).toBeVisible({ timeout: 60000 });
  await expect(frame(page).getByText("Linked report").first()).toBeVisible();
});

test("what the converter refuses is underlined in the report, and nothing runs", async ({ page }) => {
  await page.goto("/?src=examples/zr2c_broken_report.prog.abap");
  await expect(page.locator("#status")).toHaveText("the app could not be started", { timeout: 120000 });

  await expect.poll(async () => (await markers(page)).filter((m) => m.message.startsWith("report2cloud: CALL TRANSACTION")))
    .toEqual([expect.objectContaining({ line: 4 })]);
});
