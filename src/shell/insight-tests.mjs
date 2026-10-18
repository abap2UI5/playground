// The Tests tab: what the last Run's unit tests said - set by run( ) in
// run.mjs from the runtime's answer (runUnitTests( ) in
// src/runtime/index.mjs); a run with no test include sets an empty list,
// which the tab explains.
import { empty, redrawIf } from "./insight-common.mjs";

let testResults = [];

export function setTestResults(results) {
  testResults = results ?? [];
  paintTestCount();
  redrawIf("tests");
}

function paintTestCount() {
  const badge = document.getElementById("test-count");
  if (!badge) return;
  const failed = testResults.filter((r) => !r.passed).length;
  badge.textContent = testResults.length === 0 ? "" : failed > 0 ? String(failed) : "✓";
  badge.className = `insight-badge${failed > 0 ? " is-error" : testResults.length > 0 ? " is-ok" : ""}`;
}

// One row per test method: passed or failed, the class and the method, how
// long it took, and for a failure the assertion's message with what was
// expected and what was there. A row goes to the assertion's line - the
// runtime traces the JavaScript frame the assertion was raised from back to
// the test include - and, for a test that passed, nowhere.
export function testsTab() {
  if (testResults.length === 0) {
    return empty(
      "No tests ran. Add a file called <class>.clas.testclasses.abap beside your class - the + in the file strip " +
        "offers it - with local classes FOR TESTING, and Run runs them before starting the app.",
    );
  }
  const wrap = document.createElement("div");
  wrap.className = "tests";

  const passed = testResults.filter((r) => r.passed).length;
  const failed = testResults.length - passed;
  const head = document.createElement("p");
  head.className = `tests-summary${failed > 0 ? " is-error" : ""}`;
  head.textContent =
    failed === 0
      ? `${passed} test${passed === 1 ? "" : "s"} passed`
      : `${failed} of ${testResults.length} test${testResults.length === 1 ? "" : "s"} failed`;
  wrap.append(head);

  const list = document.createElement("ul");
  list.className = "insight-list";
  for (const result of testResults) {
    const item = document.createElement("li");
    const row = document.createElement(result.location ? "button" : "div");
    if (result.location) row.type = "button";
    row.className = `insight-row test-row is-${result.passed ? "ok" : "error"}`;
    if (result.location) {
      row.dataset.file = result.location.file;
      row.dataset.line = String(result.location.line);
      row.dataset.column = "1";
    }

    const mark = document.createElement("span");
    mark.className = "test-mark";
    mark.textContent = result.passed ? "✓" : "✗";

    const name = document.createElement("span");
    name.className = "insight-what test-name";
    name.textContent = `${result.testclass.toLowerCase()}->${result.method.toLowerCase()}`;

    const took = document.createElement("span");
    took.className = "insight-who";
    took.textContent = `${Math.max(1, Math.round(result.microseconds / 1000))} ms`;

    row.append(mark, name, took);
    item.append(row);

    if (!result.passed) {
      const detail = document.createElement("div");
      detail.className = "test-detail";
      const lines = [];
      if (result.message) lines.push(result.message);
      if (result.expected !== "" || result.actual !== "") {
        lines.push(`expected: ${result.expected}`, `actual:   ${result.actual}`);
      }
      if (lines.length === 0) lines.push(result.status.toLowerCase());
      detail.textContent = lines.join("\n");
      item.append(detail);
    }
    list.append(item);
  }
  wrap.append(list);
  return wrap;
}
