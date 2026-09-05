import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { MAIN_CLASS, open, setSource } from "./helpers.mjs";

// The measurement abap2UI5/docs cannot make: does an example that carries a Run
// button actually start?
//
// That repository decides WHICH examples get a button (docs/.vitepress/
// playground.mjs) and gates the bookkeeping around it, and its AGENTS.md says
// plainly that whether a buttoned example runs is the one question its CI
// cannot answer - only a playground can, and a playground is a build of this
// repository. So the driving half lives here, where the browser harness
// already is, rather than making a documentation site depend on Playwright to
// run something once a quarter.
//
// Not part of `npm test`: it is a measurement, it needs a worklist this
// repository does not hold, and it takes minutes. With no worklist the file
// contributes no tests at all.
//
//   # in a docs checkout
//   npm run runnable -- --json > /tmp/runnable.json
//   # here, against a built dist/
//   RUNNABLE_JSON=/tmp/runnable.json npm test -- docs-examples
//
// Each entry carries the ABAP the button sends - the fence VERBATIM, which is
// what the client reads off the rendered page. The class is renamed to the
// open file's: the playground refuses the pair when they disagree, exactly as
// a system does, and nothing in these examples depends on the name.
//
// A failure here is not always the documentation's. An example may name
// framework API newer than the commit tools/fetch-deps.mjs pins, in which case
// the playground is right to refuse it and the pin is what moves.
const EXAMPLES = process.env.RUNNABLE_JSON
  ? JSON.parse(readFileSync(process.env.RUNNABLE_JSON, "utf8"))
  : [];

for (const [i, ex] of EXAMPLES.entries()) {
  test(`${String(i).padStart(2, "0")} ${ex.page} :: ${ex.class}`, async ({ page }) => {
    await open(page);
    await setSource(page, ex.abap.replace(new RegExp(ex.class, "gi"), MAIN_CLASS));

    // The frame's src carries a counter that goes up once per run, so waiting
    // on it is unambiguous where the status line is not: it still says
    // "running" from the sample the page opened on while this one compiles.
    const before = await page.locator("#app").getAttribute("src");
    await page.locator("#run").click();
    await expect(page.locator("#app")).not.toHaveAttribute("src", before ?? "", { timeout: 90000 });
    await expect(page.locator("#status")).toHaveText(/^running/, { timeout: 90000 });

    // Compiled and started is not the same as on screen, and an example that
    // renders an empty page is what the docs rule "displays something" exists
    // for. A frame that has just been replaced is empty for a moment, so poll.
    await expect
      .poll(async () => (await page.frameLocator("#app").locator("body").innerText()).trim().length, {
        timeout: 60000,
        message: "the app frame never showed anything",
      })
      .toBeGreaterThan(0);
  });
}
