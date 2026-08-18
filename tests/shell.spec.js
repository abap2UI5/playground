import { test, expect } from "@playwright/test";
import { getSource, open, runSample, setSource } from "./helpers.mjs";

// The playground around the editor: sharing a link, keeping a draft, and the
// two shapes the page takes.

const MARKER = "written for the share test";

test("Share puts the code in the address bar and the link brings it back", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);

  const source = (await getSource(page)).replace("Hello abap2UI5", MARKER);
  await setSource(page, source);
  await page.locator("#share").click();
  await expect(page.locator("#status")).toContainText("link", { timeout: 15000 });

  const shared = page.url();
  expect(shared, "the code travels in the fragment, not the query").toContain("#");
  // Short enough to paste into a chat: the source is deflated before it is
  // encoded, and ABAP compresses well.
  expect(shared.length).toBeLessThan(source.length);

  // Open it as somebody receiving the link would - in a browser context that
  // has never seen this playground. A page in the same context would share its
  // localStorage, and the draft saved above already contains the marker - the
  // link could be completely broken and the assertion would still hold.
  const elsewhere = await browser.newContext();
  const fresh = await elsewhere.newPage();
  await fresh.goto(shared);
  await expect(fresh.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(fresh)).toContain(MARKER);
  await elsewhere.close();
});

test("editing after a share retires the link, and the reload keeps the edits", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);

  await setSource(page, (await getSource(page)).replace("Hello abap2UI5", "the shared version"));
  await page.locator("#share").click();
  await expect(page.locator("#status")).toContainText("link", { timeout: 15000 });
  expect(page.url()).toContain("#");

  // The next edit makes the fragment a lie, so it goes. Were it kept, this
  // reload would decode it - a link outranks the stored draft - and the editor
  // would quietly travel back to the shared version, which the first keystroke
  // would then write over the newer draft.
  await setSource(page, (await getSource(page)).replace("the shared version", "edited after sharing"));
  expect(page.url()).not.toContain("#");

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("edited after sharing");
});

test("a link nobody wrote opens on the sample instead of failing", async ({ page }) => {
  await page.goto("/#thisisnotavalidfragment");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("CLASS zcl_playground DEFINITION");
});

test("the editor content survives a reload", async ({ page }) => {
  await open(page);
  await setSource(page, (await getSource(page)).replace("Hello abap2UI5", "kept across a reload"));

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(await getSource(page)).toContain("kept across a reload");

  // And the menu says where the code came from rather than naming a sample it
  // is not.
  await expect(page.locator("#samples")).toHaveValue("");
});

test("picking a sample replaces the draft", async ({ page }) => {
  await open(page);
  await setSource(page, (await getSource(page)).replace("Hello abap2UI5", "about to be replaced"));

  await runSample(page, "counter");
  expect(await getSource(page)).not.toContain("about to be replaced");
  expect(await getSource(page)).toContain("Counter");
});

test("the splitter moves the divide and remembers it", async ({ page }) => {
  await open(page);

  const width = async () => (await page.locator("#pane-left").boundingBox()).width;
  const before = await width();

  const splitter = page.locator("#splitter");
  const box = await splitter.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = await width();
  expect(after).toBeLessThan(before - 100);

  await page.reload();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });
  expect(Math.abs((await width()) - after)).toBeLessThan(20);
});

test("a narrow window shows tabs instead of a split", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await open(page);

  await expect(page.locator(".tabs")).toBeVisible();
  await expect(page.locator("#splitter")).toBeHidden();

  // One pane at a time, and the tabs switch between them.
  await expect(page.locator("#pane-left")).toBeVisible();
  await expect(page.locator("#pane-right")).toBeHidden();

  await page.locator(".tab", { hasText: "App" }).click();
  await expect(page.locator("#pane-right")).toBeVisible();
  await expect(page.locator("#pane-left")).toBeHidden();
});

test("both panes stay visible when a wide window gets narrow and wide again", async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 480, height: 800 });
  await page.locator(".tab", { hasText: "App" }).click();
  await expect(page.locator("#pane-left")).toBeHidden();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("#pane-left")).toBeVisible();
  await expect(page.locator("#pane-right")).toBeVisible();
});

test("the app follows the system theme, and a change does not restart it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);

  // The frame is started in UI5's dark theme, matching the rest of the page.
  await expect(page.locator("#app")).toHaveAttribute("src", /sap-ui-theme=sap_horizon_dark/);
  const dark = await page.frameLocator("#app").locator("body").evaluate((b) => getComputedStyle(b).backgroundColor);

  // Type something, then switch the system theme: the app changes colour but
  // keeps what was typed - somebody with a half-filled form is not punished
  // for the sun going down.
  await page.frameLocator("#app").locator('[id$="--inpName-inner"]').fill("still here");
  await page.emulateMedia({ colorScheme: "light" });

  await expect
    .poll(async () =>
      page.frameLocator("#app").locator("body").evaluate((b) => getComputedStyle(b).backgroundColor),
    )
    .not.toBe(dark);
  await expect(page.frameLocator("#app").locator('[id$="--inpName-inner"]')).toHaveValue("still here");
});
