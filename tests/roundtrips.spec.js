import { test, expect } from "@playwright/test";
import { control, open } from "./helpers.mjs";

// The Roundtrips tab: the conversation between the frontend and the app,
// which the playground is in the middle of - see src/shell/roundtrips.mjs.

test("every roundtrip is listed with its event and what the answer did, and opens into its bodies", async ({ page }) => {
  await open(page);
  await page.locator('[data-insight="roundtrips"]').click();
  const rows = page.locator(".roundtrip-row");
  // The app started: one roundtrip, which brought the main view.
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("app start");
  await expect(rows.nth(0)).toContainText("view MAIN");
  await expect(rows.nth(0)).toContainText(/\d+ ms/);
  await expect(page.locator("#roundtrip-count")).toHaveText("1");

  // A press of the button: the event, by name, and the model that came back.
  await control(page, "inpName", "-inner").fill("Trace");
  await control(page, "btnGreet").click();
  await expect(control(page, "txtGreeting")).toContainText("Hello Trace!");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("GREET");
  await expect(rows.nth(1)).toContainText("model");
  await expect(page.locator("#roundtrip-count")).toHaveText("2");

  // Opened, a row shows the request and the response as they travelled -
  // the event in the request, the greeting in the response's model.
  await rows.nth(1).click();
  const detail = page.locator(".roundtrip-detail");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".roundtrip-body").filter({ hasText: '"EVENT": "GREET"' })).toBeVisible();
  await expect(detail.locator(".roundtrip-body").filter({ hasText: "Hello Trace!" })).toBeVisible();
  // And the first row's answer carried the view, shown one element per line.
  await rows.nth(0).click();
  await expect(page.locator(".roundtrip-detail .roundtrip-body").first()).toContainText('<Button id="btnGreet"');

  // Run starts the conversation over.
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(rows).toHaveCount(1);
});
