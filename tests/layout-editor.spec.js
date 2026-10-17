import { test, expect } from "@playwright/test";
import { inflateRawSync } from "node:zlib";
import { allowClipboard, getSource, MAIN_FILE, MAIN_MARK, open, setSource } from "./helpers.mjs";

// Open in Layout Editor, in the Share dialog (src/shell/layout-editor.mjs):
// the way back to abap2UI5/layout-editor. A class still exactly as it came
// from GitHub goes as ?src=<raw URL>, which the layout editor reads today;
// anything else goes to the clipboard and rides in the link's fragment in
// this playground's share format, behind #playground=.
const LAYOUT_EDITOR = "https://abap2ui5.github.io/layout-editor/";

// The layout editor itself is not what is tested, and CI has no business
// fetching it: every request to it is answered with an empty page.
test.beforeEach(async ({ context }) => {
  await context.route(`${LAYOUT_EDITOR}**`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>layout editor</title>" }));
});

async function openInLayoutEditor(page) {
  await page.locator("#share").click();
  await expect(page.locator("#share-dialog")).toBeVisible();
  const button = page.locator("#share-layout-editor");
  await expect(button).toBeEnabled();
  const [popup] = await Promise.all([page.waitForEvent("popup"), button.click()]);
  return new URL(popup.url());
}

test("an unchanged sample goes to the layout editor by its GitHub URL", async ({ page }) => {
  await open(page);
  const url = await openInLayoutEditor(page);
  expect(`${url.origin}${url.pathname}`).toBe(LAYOUT_EDITOR);
  const src = new URL(url.searchParams.get("src"));
  expect(src.hostname).toBe("raw.githubusercontent.com");
  expect(src.pathname.endsWith(`/${MAIN_FILE}`)).toBe(true);
  await expect(page.locator("#share-layout-editor-said")).toHaveText("opened in a new tab");
});

test("an edited class goes in the clipboard and in the link's fragment", async ({ page, context, browserName }) => {
  await allowClipboard(context, browserName);
  await open(page);
  const edited = (await getSource(page)).replace(MAIN_MARK, `${MAIN_MARK} - laid out`);
  await setSource(page, edited);
  const url = await openInLayoutEditor(page);
  expect(url.search).toBe("");
  expect(url.hash.startsWith("#playground=2")).toBe(true);
  const payload = url.hash.slice("#playground=2".length).replaceAll("-", "+").replaceAll("_", "/");
  const files = JSON.parse(inflateRawSync(Buffer.from(payload, "base64")).toString("utf8"));
  expect(files).toEqual([{ name: MAIN_FILE, source: edited }]);
  if (browserName === "chromium") {
    await expect(page.locator("#share-layout-editor-said")).toContainText("the class is in your clipboard");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(edited);
  }
});
