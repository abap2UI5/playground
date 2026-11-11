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
  // The tool's name beside "abap2UI5" (`.tool-switch-name`) is the family's
  // one red accent, #d03c4a, at 15px bold on the sunken page #f4f5f7: 4.34:1,
  // under the 4.5:1 AA asks of text below 18.7px bold. The accent is a
  // family decision (CONVENTION.md in abap2UI5/abap2UI5.github.io, and the
  // layout editor's styles.css carries the same value), not this page's to
  // darken alone. Every other node is held to the rule.
  ["color-contrast", "only the tool's name in the accent, see above"],
]);
// The one node the allowance is for: anything else failing color-contrast is
// still red.
const ALLOWED_NODES = { "color-contrast": [".toolbar-brand > details > summary"] };

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
      ? { ...v, nodes: v.nodes.filter((n) => !(ALLOWED_NODES[v.id] ?? []).includes(n.target.join(" "))) }
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
