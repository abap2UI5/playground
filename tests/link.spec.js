import { test, expect } from "@playwright/test";
import { control, getSource, openFiles } from "./helpers.mjs";

// Two ways of arriving at the playground that are not "somebody opened it":
// a link that names ABAP living somewhere else, and an embed in another page.

test("?src= opens the class the link names, and runs it", async ({ page }) => {
  await page.goto("/?src=examples/zcl_linked_example.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  // The file keeps the name it had, and the class it declares is what runs -
  // the playground has no fixed name it insists on.
  expect(await openFiles(page)).toEqual(["zcl_linked_example.clas.abap"]);
  await expect(page.frameLocator("#app").getByText("Linked example")).toBeVisible();
  await expect(control(page, "txtNote")).toContainText("fetched from a URL");
});

test("several ?src= parameters open several files, the first one being the app", async ({ page }) => {
  await page.goto("/?src=examples/zcl_linked_pair.clas.abap&src=examples/zcl_linked_helper.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  expect(await openFiles(page)).toEqual(["zcl_linked_pair.clas.abap", "zcl_linked_helper.clas.abap"]);
  // The app is the first one, and it calls the second - which only compiles
  // because both were linked.
  await expect(control(page, "txtNote")).toContainText("TWO FILES, ONE LINK!");
});

test("two linked files under the same name are refused rather than silently merged", async ({ page }) => {
  await page.goto("/?src=examples/zcl_linked_example.clas.abap&src=examples/zcl_linked_example.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#output-body")).toContainText("both called");
});

test("a link to somewhere the playground will not fetch from says so", async ({ page }) => {
  await page.goto("/?src=https://example.invalid/zcl_thing.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  // It falls back to the sample rather than showing nothing, and says what
  // happened - somebody followed a link expecting particular code.
  await expect(page.locator("#output-body")).toContainText("example.invalid");
  await expect(page.locator("#output-body")).toContainText("raw.githubusercontent.com");
  expect(await getSource(page)).toContain("CLASS zcl_playground DEFINITION");
});

test("a link to a file that is not an ABAP object says so", async ({ page }) => {
  await page.goto("/?src=index.html");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(page.locator("#output-body")).toContainText("not an ABAP object file");
});

test("the embedded playground drops the chrome and keeps the code", async ({ page }) => {
  await page.goto("/?embed=1&src=examples/zcl_linked_example.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  await expect(page.locator(".brand")).toBeHidden();
  await expect(page.locator("#samples")).toBeHidden();
  await expect(page.locator("#share")).toBeHidden();

  // Still a playground: the editor is there and Run works.
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.locator("#run")).toBeEnabled();
  await expect(page.frameLocator("#app").getByText("Linked example")).toBeVisible();
});

test("an embedded playground does not write over the draft of a normal one", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  await page.evaluate(() =>
    window.monaco.editor
      .getModel(window.monaco.Uri.parse("file:///zcl_playground.clas.abap"))
      .setValue("CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.\n\" my own work\nENDCLASS.\nCLASS zcl_playground IMPLEMENTATION.\nENDCLASS."),
  );
  await page.waitForTimeout(500);

  await page.goto("/?embed=1&src=examples/zcl_linked_example.clas.abap");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("my own work");
});
