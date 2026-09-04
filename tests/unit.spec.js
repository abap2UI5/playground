import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { addNamedFile, control, getSource, MAIN_CLASS, MAIN_FILE, open, openFiles, setSource } from "./helpers.mjs";

// ABAP Unit in the browser: the local test classes in a class's test include,
// run by Run before the app starts - see runUnitTests( ) in
// src/runtime/index.mjs and the Tests tab in src/shell/insight.mjs.
//
// The app and its tests are a fixture of this file rather than a sample in the
// menu. They used to be one, back when the playground wrote its own samples;
// the samples come out of abap2UI5/samples now, and a class that exists to
// have a test broken in it is not a sample - it is what this test needs.
const fixture = (name) =>
  readFileSync(new URL(`fixtures/${name}.abap`, import.meta.url), "utf8").replaceAll("%CLASS%", MAIN_CLASS);

const TESTS = `${MAIN_CLASS}.clas.testclasses.abap`;

test("a failing test is listed with what was expected, and its row goes to the assertion", async ({ page }) => {
  await open(page);
  await setSource(page, fixture("unit-app"), MAIN_FILE);
  await addNamedFile(page, TESTS);
  await setSource(page, fixture("unit-tests"), TESTS);
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });

  // Break one expectation. The app still starts - a failing test is no
  // reason to withhold the thing it is about - and the status line says so.
  const source = await getSource(page, TESTS);
  await setSource(page, source.replace("exp = 119", "exp = 120"), TESTS);
  const line = source.split("\n").findIndex((l) => l.includes("exp = 119")) + 1;
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running - 1 of 3 tests failed", { timeout: 60000 });
  await expect(control(page, "btnCalc")).toBeVisible();

  // The Tests tab came forward on its own, with the failure and the two that
  // passed, and the badge counts the failure.
  await expect(page.locator('[data-insight="tests"]')).toHaveClass(/is-active/);
  await expect(page.locator("#test-count")).toHaveText("1");
  await expect(page.locator(".tests-summary")).toHaveText("1 of 3 tests failed");
  await expect(page.locator(".test-row.is-ok")).toHaveCount(2);
  const failed = page.locator(".test-row.is-error");
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText("ltcl_with_tax->nineteen_percent");
  const detail = page.locator(".test-detail");
  await expect(detail).toContainText("expected: 120");
  await expect(detail).toContainText("actual:   119");

  // The row goes to the assertion - in the test include, at the line of the
  // expectation that failed (the statement starts two lines above `exp =`).
  await failed.click();
  await expect(page.locator(".file-tab.is-active")).toContainText(TESTS);
  const at = await page.evaluate(() => window.monaco.editor.getEditors()[0].getPosition().lineNumber);
  expect(Math.abs(at - line)).toBeLessThanOrEqual(2);

  // Mended, the next run is green again.
  await setSource(page, source, TESTS);
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.locator("#test-count")).toHaveText("✓");
});

test("a test include is added from the strip with a skeleton that passes, and needs its class", async ({ page }) => {
  await open(page);
  // The skeleton: one test, one assertion that holds.
  await addNamedFile(page, TESTS);
  expect(await openFiles(page)).toContain(TESTS);
  expect(await getSource(page, TESTS)).toContain("FOR TESTING");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await page.locator('[data-insight="tests"]').click();
  await expect(page.locator(".tests-summary")).toHaveText("1 test passed");

  // A test include for a class that is not open is refused, and says why.
  await page.locator(".file-add").click();
  await page.locator(".file-new").fill("zcl_elsewhere.clas.testclasses.abap");
  await page.locator(".file-new").press("Enter");
  await expect(page.locator("#status")).toContainText("add the class first");
  expect(await openFiles(page)).not.toContain("zcl_elsewhere.clas.testclasses.abap");
});

test("without a test include the Tests tab says how to get one", async ({ page }) => {
  await open(page);
  await page.locator('[data-insight="tests"]').click();
  await expect(page.locator("#insight-body")).toContainText("testclasses.abap");
  await expect(page.locator("#test-count")).toHaveText("");
});
