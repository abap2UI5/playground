// The capability markers on a sample's title (src/shell/sample-marks.mjs):
// exactly `(A)`, `(C)` and `(A,C)` at the very end come off and become words;
// anything that only looks like one is the author's own text and stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKS, marksOf, splitMarks } from "../../src/shell/sample-marks.mjs";

test("the three markers come off the end, as the marks they stand for", () => {
  assert.deepEqual(splitMarks("Drag and Drop Nodes (A,C)"), { text: "Drag and Drop Nodes", marks: ["A", "C"] });
  assert.deepEqual(splitMarks("Inside a Dialog (C)"), { text: "Inside a Dialog", marks: ["C"] });
  assert.deepEqual(splitMarks("Timer (A)"), { text: "Timer", marks: ["A"] });
});

test("what only looks like a marker is left as it was written", () => {
  for (const text of ["Value Help (F4)", "Lower (a)", "Swapped (C,A)", "(A) at the start", "Plain"]) {
    assert.deepEqual(splitMarks(text), { text, marks: [] });
  }
  assert.deepEqual(splitMarks(undefined), { text: "", marks: [] });
});

test("a row's title and note are read together, their marks merged in order", () => {
  assert.deepEqual(marksOf("Tree (C)", "Drag and Drop Nodes (A)"), {
    texts: ["Tree", "Drag and Drop Nodes"],
    marks: ["A", "C"],
  });
  for (const mark of Object.values(MARKS)) assert.ok(mark.label && mark.title);
});
