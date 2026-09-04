import { test, expect } from "@playwright/test";
import { addNamedFile, clickEditor, getSource, MAIN_CLASS, MAIN_FILE, MAIN_MARK, open, openFiles, runSample, sampleFiles, setSource } from "./helpers.mjs";

// The two-class sample, and its files in the order the strip shows them: the
// app first, the one it calls second.
const [NAV_APP, NAV_CALLED] = sampleFiles("navigation");

// More than one class: the file strip, the rule about which one runs, and the
// checks that keep a second file from failing in a way nobody can read.

test("a single-class playground shows one tab, and a sample with two shows two", async ({ page }) => {
  await open(page);
  expect(await openFiles(page)).toEqual([MAIN_FILE]);

  await runSample(page, "navigation");
  expect(await openFiles(page)).toEqual([NAV_APP, NAV_CALLED]);
  await expect(page.locator(".file-tab")).toHaveCount(2);
});

test("the file tabs switch what the editor is showing", async ({ page }) => {
  await open(page);
  await runSample(page, "navigation");

  await expect(page.locator("#editor")).toContainText(`CLASS ${NAV_APP.replace(".clas.abap", "")} DEFINITION`);
  await page.locator(".file-tab", { hasText: NAV_CALLED }).click();
  await expect(page.locator("#editor")).toContainText(`CLASS ${NAV_CALLED.replace(".clas.abap", "")} DEFINITION`);
});

test("adding a file gives it a skeleton, and it compiles", async ({ page }) => {
  await open(page);

  await addNamedFile(page, "zcl_helper.clas.abap");

  expect(await openFiles(page)).toContain("zcl_helper.clas.abap");
  expect(await getSource(page, "zcl_helper.clas.abap")).toContain("CLASS zcl_helper DEFINITION");

  // A new file is a valid object from the moment it exists, so the run that
  // follows is about the code, not about the skeleton.
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
});

test("a file cannot be named something abapGit would not name", async ({ page }) => {
  await open(page);

  await page.locator(".file-add").click();
  await page.locator(".file-new").fill("Helper.java");
  await page.locator(".file-new").press("Enter");

  // The refusal goes to the status line, which is a channel an embedded
  // playground can actually show - unlike the alert( ) this used to be.
  await expect(page.locator("#status")).toContainText(".clas.abap");
  // And the input is still there with the name in it, because the answer to a
  // rejected name is nearly always a small correction.
  await expect(page.locator(".file-new")).toBeVisible();
  expect(await openFiles(page)).toEqual([MAIN_FILE]);

  // Correcting it in place is enough - no second press of "+".
  await page.locator(".file-new").fill("zcl_helper.clas.abap");
  await page.locator(".file-new").press("Enter");
  expect(await openFiles(page)).toContain("zcl_helper.clas.abap");
});

test("naming a new file can be abandoned with Escape", async ({ page }) => {
  await open(page);

  await page.locator(".file-add").click();
  await expect(page.locator(".file-new")).toBeVisible();
  await page.locator(".file-new").press("Escape");

  await expect(page.locator(".file-new")).toHaveCount(0);
  await expect(page.locator(".file-add")).toBeVisible();
  expect(await openFiles(page)).toEqual([MAIN_FILE]);
});

test("the first file cannot be closed, a later one can", async ({ page }) => {
  await open(page);
  await runSample(page, "navigation");

  // No close control on the first tab - closing it would silently change what
  // the playground runs.
  await expect(page.locator(".file-tab").first().locator(".file-close")).toHaveCount(0);

  await page.locator(".file-tab", { hasText: NAV_CALLED }).locator(".file-close").click();
  expect(await openFiles(page)).toEqual([NAV_APP]);
});

test("a class whose name does not match its file is explained", async ({ page }) => {
  await open(page);

  await addNamedFile(page, "zcl_helper.clas.abap");
  await setSource(page, "CLASS zcl_wrong DEFINITION PUBLIC CREATE PUBLIC.\nENDCLASS.\nCLASS zcl_wrong IMPLEMENTATION.\nENDCLASS.", "zcl_helper.clas.abap");

  await page.locator("#run").click();
  await expect(page.locator(".log-body")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".log-body")).toContainText("ZCL_HELPER");
  await expect(page.locator(".log-body")).toContainText("ZCL_WRONG");
});

test("an error in the second file names the file it is in", async ({ page }) => {
  await open(page);
  await runSample(page, "navigation");

  await setSource(page, (await getSource(page, NAV_CALLED)).replace("me->client = client.", "me->client = = client."), NAV_CALLED);
  await page.locator("#run").click();

  // With more than one file open, each problem row says which file it is in -
  // that is where the name lives now, and it is clickable.
  await expect(
    page.locator(".insight-row.is-error", { hasText: NAV_CALLED }).first(),
  ).toBeVisible({ timeout: 30000 });
});

test("two apps can call each other", async ({ page }) => {
  await open(page);
  await runSample(page, "navigation");

  // The first app calls the second with nav_app_call, and the second one's own
  // Page arrives in the same frame - two classes, one running playground.
  await page.frameLocator("#app").getByRole("button", { name: "call new app (first View)" }).click();
  // The second app's own view, from the second file: its title and the button
  // that takes control back to the caller.
  await expect(page.frameLocator("#app").getByText("flow logic - APP 02")).toBeVisible({ timeout: 30000 });
  await expect(page.frameLocator("#app").getByRole("button", { name: "back" }).first()).toBeVisible();
});

test("completion offers a class that was added a moment ago", async ({ page }) => {
  await open(page);

  await addNamedFile(page, "zcl_freshly_added.clas.abap");

  // Back to the app, and ask for a class the corpus never had.
  await page.locator(".file-tab").first().click();
  await clickEditor(page);
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("zcl_freshly");
  await page.keyboard.press("Control+Space");

  await expect(page.locator(".suggest-widget")).toContainText("zcl_freshly_added", { timeout: 10000 });
});

test("two runs at once do not race", async ({ page }) => {
  await open(page);

  // Ctrl+Enter and the Run button go through the same guard: the second call
  // returns immediately rather than resetting the database under a frame that
  // is still booting.
  await page.evaluate(() => {
    const key = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true });
    document.dispatchEvent(key);
    document.dispatchEvent(key);
    document.getElementById("run").click();
  });

  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.frameLocator("#app").getByText(MAIN_MARK)).toBeVisible();
});
