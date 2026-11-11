// The measurement's summary (tools/docs-examples-summary.mjs): a Playwright
// JSON report read into "n of m started" and a row per failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarise, testsOf } from "../../tools/docs-examples-summary.mjs";

const REPORT = {
  suites: [{
    title: "docs-examples.spec.js",
    specs: [],
    suites: [{
      title: "",
      specs: [
        { title: "00 cookbook/a.md :: zcl_a", tests: [{ results: [{ status: "passed" }] }] },
        { title: "01 cookbook/b.md :: zcl_b", tests: [{ results: [{ status: "failed", error: { message: "\u001b[31mthe app frame | never showed anything\u001b[39m\nstack" } }] }] },
      ],
    }],
  }],
};

test("every test in the report is found, nested or not", () => {
  const tests = testsOf(REPORT);
  assert.deepEqual(tests.map((t) => [t.title, t.ok]), [["00 cookbook/a.md :: zcl_a", true], ["01 cookbook/b.md :: zcl_b", false]]);
});

test("the summary counts, names the failing page, and escapes the table", () => {
  const { markdown, ok } = summarise(testsOf(REPORT));
  assert.equal(ok, false);
  assert.match(markdown, /^### Documentation examples: 1 of 2 started/);
  assert.match(markdown, /\| 01 cookbook\/b\.md :: zcl_b \| the app frame \\\| never showed anything \|/);
  assert.ok(!markdown.includes("\u001b"));
});

test("an empty report is not a green one", () => {
  assert.equal(summarise(testsOf({})).ok, false);
  assert.equal(summarise([{ title: "x", ok: true, error: "" }]).ok, true);
});
