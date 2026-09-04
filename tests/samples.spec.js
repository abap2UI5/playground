import { test, expect } from "@playwright/test";
import { open, runSample, SAMPLES } from "./helpers.mjs";

// Every sample the page carries, run. A sample that no longer compiles or no
// longer renders is worse than no sample: somebody picks it to learn from and
// gets an error page instead.
//
// The list is read from what the build produced (build/samples/index.json,
// written by writeSamples( ) in tools/build-site.mjs out of the pinned
// abap2UI5/samples), so it cannot drift from the menu: a class added to
// src/editor/sample-list.mjs is a test here without anybody writing one.
//
// And there is nothing to write, which is the point of checking it this way.
// These samples are not ours: they are abap2UI5/samples' own, and a check that
// clicked a control by id would have to be rewritten every time that repository
// improved one. What every sample there does hold to is its Page title -
// `abap2UI5 - <title> - <description>` - so the proof that a sample ran, rather
// than merely compiled, is that its own description is on the screen. If a
// sample ever stops following that convention this fails, which is the right
// moment to look at it.

// What the panel is allowed to say the moment a sample is opened, as the
// problem badge shows it - empty when there is nothing to report.
//
// A sample somebody picked to learn from should not greet them with a
// complaint about the code they were handed, so the answer is "" unless a
// sample is named here. Naming one is not tolerating it: the linter and the
// samples move independently, and a rule that starts reporting one of these
// has to be a red test rather than a surprise on the deployed page.
const REPORTED = {};

for (const sample of SAMPLES) {
  test(`the "${sample.title}" sample compiles and runs`, async ({ page }) => {
    await open(page);
    await runSample(page, sample.id);

    await expect(
      page.frameLocator("#app").getByText(sample.title, { exact: false }).first(),
      "the sample titles its Page after itself, so this is the app on screen",
    ).toBeVisible({ timeout: 30000 });

    await expect(
      page.locator("#problem-count"),
      `the "${sample.title}" sample reports something it does not mean to`,
    ).toHaveText(REPORTED[sample.id] ?? "");
  });
}
