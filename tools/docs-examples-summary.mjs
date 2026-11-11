// The documentation's runnable examples, measured (docs-examples.yml): how many
// of the examples abap2UI5/docs gives a Run button started here, as the job
// summary's table, from Playwright's JSON report of tests/docs-examples.spec.js.
//
//   node tools/docs-examples-summary.mjs test-results/docs-examples.json
//
// A failure names the page, because that is what somebody opens next - and
// says in which order to read it: an example can name framework API newer
// than the pin in tools/fetch-deps.mjs, in which case the page is right and
// the pin is what moves (abap2UI5/docs' AGENTS.md, "The Run button").
import { existsSync, readFileSync } from "node:fs";

// Playwright colours its messages; a table cell is no terminal.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Every test in a Playwright JSON report, as { title, ok, error }. */
export function testsOf(report) {
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1];
        const ok = last?.status === "passed";
        const error = ok ? "" : String(last?.error?.message ?? last?.status ?? "not run").split("\n")[0];
        out.push({ title: spec.title, ok, error });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return out;
}

/** The summary as markdown, and whether every example started. */
export function summarise(tests) {
  const cell = (s) => String(s).replace(/\|/g, "\\|").replace(ANSI, "");
  const started = tests.filter((t) => t.ok).length;
  const lines = [`### Documentation examples: ${started} of ${tests.length} started`, ""];
  const failed = tests.filter((t) => !t.ok);
  if (tests.length === 0) {
    lines.push("No examples were measured - the worklist was empty or the run broke before it; see the log.");
  } else if (failed.length) {
    lines.push("| example | what happened |", "| --- | --- |");
    for (const t of failed) lines.push(`| ${cell(t.title)} | ${cell(t.error)} |`);
    lines.push(
      "",
      "Read a failure in this order: the page first, then the framework pin in `tools/fetch-deps.mjs` - " +
        "an example that names API newer than the pin is right, and the pin is what moves.",
    );
  }
  return { markdown: lines.join("\n"), ok: tests.length > 0 && failed.length === 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] ?? "test-results/docs-examples.json";
  const report = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const { markdown, ok } = summarise(testsOf(report));
  console.log(markdown);
  if (!ok) process.exitCode = 1;
}
