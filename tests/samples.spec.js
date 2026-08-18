import { test, expect } from "@playwright/test";
import { control, open, runSample } from "./helpers.mjs";

// Every sample in the menu, run. A sample that no longer compiles or no longer
// renders is worse than no sample: somebody picks it to learn from and gets an
// error page instead.
//
// The catalogue is imported so this list cannot drift from the menu - adding a
// sample without a check here is not possible.
import { SAMPLES } from "../src/editor/samples.mjs";

// What proves each one actually ran, rather than merely compiling: a piece of
// the view it builds, and where there is an interaction, the result of it.
const CHECKS = {
  hello: async (page) => {
    await expect(page.frameLocator("#app").getByText("Hello abap2UI5")).toBeVisible();
    await control(page, "inpName", "-inner").fill("Sample");
    await control(page, "btnGreet").click();
    await expect(control(page, "txtGreeting")).toContainText("Hello Sample!");
  },

  counter: async (page) => {
    await expect(control(page, "txtCount")).toHaveText("0");
    await control(page, "btnUp").click();
    await expect(control(page, "txtCount")).toHaveText("1");
    await control(page, "btnUp").click();
    await expect(control(page, "txtCount")).toHaveText("2");
    // The history proves the state survived both roundtrips as a draft.
    await expect(control(page, "txtHistory")).toContainText("1 -> 2");
  },

  table: async (page) => {
    await expect(page.frameLocator("#app").getByText("San Francisco").first()).toBeVisible();
    // Tick the first two rows, then let ABAP count what came back. UI5 hides
    // the real input behind a styled box, so the control root is what a person
    // clicks and what the test clicks.
    const boxes = page.frameLocator("#app").locator("[id$='-selectMulti']");
    await boxes.nth(0).click();
    await boxes.nth(1).click();
    await control(page, "btnCount").click();
    await expect(control(page, "txtSummary")).toContainText("2 of 4 selected");
    await expect(control(page, "txtSummary")).toContainText("770 seats");
  },

  form: async (page) => {
    await control(page, "btnSubmit").click();
    // Validation runs in ABAP and comes back as a message box.
    await expect(page.frameLocator("#app").getByText("First and last name are required")).toBeVisible();
    // Whatever UI5 labels the dismiss button of an error message box.
    await page.frameLocator("#app").locator(".sapMDialog .sapMBtn").first().click();

    await control(page, "inpFirst", "-inner").fill("Ada");
    await control(page, "inpLast", "-inner").fill("Lovelace");
    await control(page, "inpMail", "-inner").fill("ada@example.org");
    await control(page, "btnSubmit").click();
    await expect(control(page, "txtResult")).toContainText("Registered Ada Lovelace");
  },

  tabs: async (page) => {
    await expect(page.frameLocator("#app").getByText("abap2UI5 keeps the state on the server")).toBeVisible();
    await page.frameLocator("#app").getByText("New", { exact: true }).click();
    await control(page, "inpDraft", "-inner").fill("a third note");
    await control(page, "btnAdd").click();
    await expect(page.frameLocator("#app").getByText("a third note")).toBeVisible();
  },

  navigation: async (page) => {
    await control(page, "btnPick").click();
    // A second app of the user's own, called with nav_app_call.
    await expect(page.frameLocator("#app").getByText("Pick one")).toBeVisible();
    await control(page, "btnGreen").click();
    // It left with nav_app_leave, and the hub read its public attribute.
    await expect(control(page, "txtPicked")).toContainText("GREEN");
  },

  popup: async (page) => {
    await expect(control(page, "txtStatus")).toContainText("nothing deleted yet");
    await control(page, "btnDelete").click();
    // The popup is an app of its own, called with nav_app_call.
    await expect(page.frameLocator("#app").getByText("Delete this record?")).toBeVisible();
    await page.frameLocator("#app").getByRole("button", { name: "OK" }).click();
    // Control comes back as a navigated roundtrip, and the app reads the result.
    await expect(control(page, "txtStatus")).toContainText("deleted");
  },
};

for (const sample of SAMPLES) {
  test(`the "${sample.title}" sample compiles and runs`, async ({ page }) => {
    await open(page);

    await runSample(page, sample.id);

    const check = CHECKS[sample.id];
    expect(check, `${sample.id} has no check - add one when adding a sample`).toBeDefined();
    await check(page);
  });
}
