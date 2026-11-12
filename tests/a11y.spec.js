import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { open } from "./helpers.mjs";

// The page's own markup against axe-core's WCAG 2.x A/AA rules: the bar, the
// file strip, the panel, the dialogs and the phone's menu, light and dark.
// Monaco and the app frame are left out - neither is this repository's markup
// (Monaco is VS Code's editor; the frame is UI5 drawing the reader's app).
//
// Only "serious" and "critical" fail the test. What is left on purpose is
// listed in ALLOWED with the reason, so a new finding is red and a known one
// is a sentence somebody can argue with.
const ALLOWED = new Map([
  // None. Add as ["rule-id", "why it stays"], and its node to ALLOWED_NODES:
  // the allowance is for that node only, matched by its element (axe's
  // `html` of it) rather than by the selector axe picks, which changes when
  // the page around it does.
]);
const ALLOWED_NODES = {};
const allowedNode = (id, node) => (ALLOWED_NODES[id] ?? []).some((pattern) => pattern.test(node.html));

async function check(page, what) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude(".monaco-editor")
    .exclude("#app")
    .exclude(".monaco-diff-editor")
    .analyze();
  const bad = result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ALLOWED.has(v.id)
      ? { ...v, nodes: v.nodes.filter((n) => !allowedNode(v.id, n)) }
      : v)
    .filter((v) => v.nodes.length > 0);
  const said = bad.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n  ")}`);
  expect(said, `${what}:\n${said.join("\n")}`).toEqual([]);
}

for (const theme of ["light", "dark"]) {
  test(`the workbench passes axe in the ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await open(page);
    await check(page, "the page after boot");

    await page.locator("#examples").click();
    await expect(page.locator("#examples-dialog")).toBeVisible();
    await check(page, "the samples dialog");
    await page.keyboard.press("Escape");

    await page.locator("#share").click();
    await expect(page.locator("#share-dialog")).toBeVisible();
    await check(page, "the share dialog");
    await page.keyboard.press("Escape");

    await page.locator("#about").click();
    await expect(page.locator("#about-dialog")).toBeVisible();
    await check(page, "the about dialog");
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the one row and its menu pass axe", async ({ page }) => {
    await open(page);
    await check(page, "the phone's page");
    await page.locator("#toolbar-more").click();
    await expect(page.locator("#toolbar-menu")).toBeVisible();
    await check(page, "the phone's menu");
  });
});
