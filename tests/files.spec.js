import { test, expect } from "@playwright/test";
import { control, getSource, open, openFiles, runSample, setSource } from "./helpers.mjs";

// More than one class: the file strip, the rule about which one runs, and the
// checks that keep a second file from failing in a way nobody can read.

test("a single-class playground shows one tab, and a sample with two shows two", async ({ page }) => {
  await open(page);
  expect(await openFiles(page)).toEqual(["zcl_playground.clas.abap"]);

  await runSample(page, "navigation");
  expect(await openFiles(page)).toEqual(["zcl_playground.clas.abap", "zcl_detail.clas.abap"]);
  await expect(page.locator(".file-tab")).toHaveCount(2);
});

test("the file tabs switch what the editor is showing", async ({ page }) => {
  await open(page);
  await runSample(page, "navigation");

  await expect(page.locator("#editor")).toContainText("CLASS zcl_playground DEFINITION");
  await page.locator(".file-tab", { hasText: "zcl_detail" }).click();
  await expect(page.locator("#editor")).toContainText("CLASS zcl_detail DEFINITION");
});

test("adding a file gives it a skeleton, and it compiles", async ({ page }) => {
  await open(page);

  page.once("dialog", (d) => d.accept("zcl_helper.clas.abap"));
  await page.locator(".file-add").click();

  expect(await openFiles(page)).toContain("zcl_helper.clas.abap");
  expect(await getSource(page, "zcl_helper.clas.abap")).toContain("CLASS zcl_helper DEFINITION");

  // A new file is a valid object from the moment it exists, so the run that
  // follows is about the code, not about the skeleton.
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
});

test("a file cannot be named something abapGit would not name", async ({ page }) => {
  await open(page);

  // Two dialogs in order: the prompt asking for a name, then the alert saying
  // why that one will not do.
  const messages = [];
  page.on("dialog", (d) => {
    messages.push(d.message());
    return messages.length === 1 ? d.accept("Helper.java") : d.accept();
  });
  await page.locator(".file-add").click();

  await expect.poll(() => messages.length).toBe(2);
  expect(messages[1]).toContain(".clas.abap");
  expect(await openFiles(page)).toEqual(["zcl_playground.clas.abap"]);
});

test("the first file cannot be closed, a later one can", async ({ page }) => {
  await open(page);
  await runSample(page, "navigation");

  // No close control on the first tab - closing it would silently change what
  // the playground runs.
  await expect(page.locator(".file-tab").first().locator(".file-close")).toHaveCount(0);

  await page.locator(".file-tab", { hasText: "zcl_detail" }).locator(".file-close").click();
  expect(await openFiles(page)).toEqual(["zcl_playground.clas.abap"]);
});

test("a class whose name does not match its file is explained", async ({ page }) => {
  await open(page);

  page.once("dialog", (d) => d.accept("zcl_helper.clas.abap"));
  await page.locator(".file-add").click();
  await setSource(page, "CLASS zcl_wrong DEFINITION PUBLIC CREATE PUBLIC.\nENDCLASS.\nCLASS zcl_wrong IMPLEMENTATION.\nENDCLASS.", "zcl_helper.clas.abap");

  await page.locator("#run").click();
  await expect(page.locator("#output")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#output-body")).toContainText("ZCL_HELPER");
  await expect(page.locator("#output-body")).toContainText("ZCL_WRONG");
});

test("an error in the second file names the file it is in", async ({ page }) => {
  await open(page);
  await runSample(page, "navigation");

  await setSource(page, (await getSource(page, "zcl_detail.clas.abap")).replace("me->client = client.", "me->client = = client."), "zcl_detail.clas.abap");
  await page.locator("#run").click();

  await expect(page.locator("#output-body")).toContainText("zcl_detail.clas.abap", { timeout: 30000 });
});

test("two apps can call each other", async ({ page }) => {
  await open(page);
  await runSample(page, "navigation");

  await control(page, "btnPick").click();
  await expect(page.frameLocator("#app").getByText("Pick one")).toBeVisible();
  await control(page, "btnBlue").click();
  await expect(control(page, "txtPicked")).toContainText("BLUE");
});
