import { test, expect } from "@playwright/test";

// Putting a live demo in somebody else's page: the app-only view, the messages
// an embedding page listens for, and the loader script that ties them together.

const SOURCE = "abap2ui5-playground";

// Everything the embedded playground says, collected from the moment the page
// exists. Installed before navigation, because "ready" arrives once and early.
async function collectMessages(page) {
  await page.addInitScript(() => {
    window.__messages = [];
    window.addEventListener("message", (e) => {
      if (e.data?.source === "abap2ui5-playground") window.__messages.push(e.data);
    });
  });
}

test("?view=app shows the app without the editor, and Run still works", async ({ page }) => {
  await page.goto("/?embed=1&view=app");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  await expect(page.locator("#pane-left")).toBeHidden();
  await expect(page.locator("#splitter")).toBeHidden();
  await expect(page.locator("#pane-right")).toBeVisible();
  await expect(page.frameLocator("#app").getByText("Hello abap2UI5")).toBeVisible();

  // The editor is gone from the screen, not from the playground - what runs is
  // still compiled from it, so Run has to still do something.
  await expect(page.locator("#run")).toBeEnabled();
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.frameLocator("#app").getByText("Hello abap2UI5")).toBeVisible();
});

test("an embedded playground reports ready, status and height to the page around it", async ({ page }) => {
  // The playground only talks when it is framed, so it gets a frame.
  await collectMessages(page);
  await page.goto("/embed/host.html");

  await expect
    .poll(() => page.evaluate(() => window.__messages.some((m) => m.type === "ready")), {
      timeout: 120000,
    })
    .toBe(true);

  const messages = await page.evaluate(() => window.__messages);
  expect(
    messages.every((m) => m.source === SOURCE),
    "every message names its sender",
  ).toBe(true);

  const status = messages.filter((m) => m.type === "status");
  expect(status.length, "the status line travels").toBeGreaterThan(0);
  expect(status.at(-1).state).toBe("running");

  const heights = messages.filter((m) => m.type === "height");
  expect(heights.length, "an app-only demo reports how tall it wants to be").toBeGreaterThan(0);
  expect(heights.at(-1).height).toBeGreaterThan(50);
});

test("a playground that is not embedded stays silent", async ({ page }) => {
  await collectMessages(page);
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("running", { timeout: 120000 });

  expect(await page.evaluate(() => window.__messages)).toEqual([]);
});

test("the loader waits for a click, then runs the example", async ({ page }) => {
  await page.goto("/embed/");

  // Nothing has loaded: three demos, three buttons, no frames.
  await expect(page.locator(".abap2ui5-demo-start")).toHaveCount(3);
  expect(await page.locator(".abap2ui5-demo iframe").count()).toBe(0);

  await page.locator(".abap2ui5-demo-start").first().click();
  const frame = page.locator(".abap2ui5-demo iframe").first();
  await expect(frame).toHaveCount(1);
  // Only the clicked one.
  await expect(page.locator(".abap2ui5-demo iframe")).toHaveCount(1);

  const demo = page.frameLocator(".abap2ui5-demo iframe").first();
  await expect(demo.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(demo.locator("#editor")).toContainText("CLASS zcl_linked_example");
});

test("inline data-code reaches the playground through the fragment", async ({ page }) => {
  await page.goto("/embed/");

  // The third demo carries its ABAP in the attribute rather than in a file. It
  // has to arrive in the format the playground's own Share button writes -
  // anything else is read as somebody else's link and silently replaced by the
  // sample, which would show a reader the wrong code.
  await page.locator(".abap2ui5-demo").nth(2).locator("button").click();
  const demo = page.frameLocator(".abap2ui5-demo iframe").first();
  await expect(demo.locator("#status")).toHaveText("running", { timeout: 120000 });
  await expect(demo.locator("#editor")).toContainText("Written in the documentation");
  await expect(
    demo.frameLocator("#app").locator('[id$="--txtInline"]'),
    "the inline example actually rendered",
  ).toContainText("This ABAP travelled in the URL.");
});
