// handoverMarkdown( ) (src/shell/handover.mjs): the record the AI App
// Builder's download carries beside the class - asked for, checked, tried,
// left to connect, and what "checked" does not mean.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handoverMarkdown } from "../../src/shell/handover.mjs";

const base = {
  app: "ZCL_ORDERS",
  files: [{ name: "zcl_orders.clas.abap" }, { name: "zcl_orders.clas.testclasses.abap" }, { name: "zorders.tabl.xml" }],
  requests: ["A list of orders", "Add a total\nbelow it"],
  release: "ABAP 7.50+ / S/4HANA",
  ui5: "1.71",
  status: "running",
  problems: [],
  tests: [],
  tried: [],
  todos: [],
  model: "Balanced · Opus 5.5",
  date: new Date("2026-11-11T12:00:00Z"),
};

test("a clean build says what ran, against what, and what it does not say", () => {
  const md = handoverMarkdown({
    ...base,
    tests: [{ testclass: "LTCL_TOTAL", method: "SUMS", passed: true }],
    tried: ['typed 1 value, pressed ADD → "Order added"'],
  });
  assert.match(md, /^# Handover: ZCL_ORDERS\n/);
  assert.match(md, /with Balanced · Opus 5.5 on 2026-11-11/);
  // Each message a quote of its own, on one line.
  assert.match(md, /> A list of orders\n\n> Add a total below it\n/);
  assert.match(md, /- `zorders.tabl.xml`/);
  assert.match(md, /The last run: \*\*running\*\*/);
  assert.match(md, /\| abaplint \(syntax\) \| ABAP 7\.50\+ \/ S\/4HANA \| 0 \| 0 \| 0 \|/);
  assert.match(md, /\| abap2UI5 linter \(view, lifecycle\) \| UI5 1\.71 \| 0 \| 0 \| 0 \|/);
  assert.match(md, /1 of 1 passed in the last run\./);
  assert.match(md, /- typed 1 value, pressed ADD → "Order added"/);
  assert.match(md, /Nothing is marked\./);
  assert.match(md, /No ATC/);
  assert.doesNotMatch(md, /Still open/);
});

test("what is still open is listed - problems, failed tests, places to connect, an app nobody tried", () => {
  const md = handoverMarkdown({
    ...base,
    status: "1 error in the ABAP",
    problems: [
      { severity: 1, source: "abaplint", rule: "check_syntax", message: "Variable \"lv_x\" not found", file: "zcl_orders.clas.abap", range: { start: { line: 11 } } },
      { severity: 2, source: "abap2UI5 lint", rule: "unknown-property", message: "Button has no property tone", file: "zcl_orders.clas.abap", range: { start: { line: 30 } } },
      { severity: 3, source: "abap2UI5 lint", message: "a hint", file: "zcl_orders.clas.abap" },
    ],
    tests: [{ testclass: "LTCL_TOTAL", method: "SUMS", passed: false, message: "expected 3, got 2" }],
    todos: [{ file: "zcl_orders.clas.abap", line: 14, text: "SELECT from VBAK goes here" }],
  });
  assert.match(md, /\| abaplint \(syntax\) \| [^|]+ \| 1 \| 0 \| 0 \|/);
  assert.match(md, /\| abap2UI5 linter \(view, lifecycle\) \| UI5 1\.71 \| 0 \| 1 \| 1 \|/);
  assert.match(md, /- zcl_orders\.clas\.abap:12 - error `check_syntax`: Variable "lv_x" not found/);
  assert.match(md, /- zcl_orders\.clas\.abap:31 - warning `unknown-property`: Button has no property tone/);
  assert.match(md, /1 hint \(advice/);
  assert.match(md, /0 of 1 passed in the last run\.\n- FAILED `LTCL_TOTAL->SUMS`: expected 3, got 2/);
  assert.match(md, /Nothing was typed or pressed in the app/);
  assert.match(md, /- zcl_orders\.clas\.abap:14 - SELECT from VBAK goes here/);
});

test("no tests and no messages are said as such, not left out", () => {
  const md = handoverMarkdown({ ...base, requests: [], model: undefined });
  assert.match(md, /_\(no message - the files were written by hand\)_/);
  assert.match(md, /None ran\./);
  assert.match(md, /Built in the abap2UI5 AI App Builder on 2026-11-11/);
});
