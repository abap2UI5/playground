// @ts-check
// The capability markers at the end of a sample's title, read out loud.
//
// abap2UI5/samples lets an author end a class's DESCRIPT in `(A)`, `(C)` or
// `(A,C)` - a frontend action, an abap2UI5 custom control, or both - and its
// catalogue.json carries the marker through as part of the text: "Drag and
// Drop Nodes (A,C)". Over there the legend travels with it
// (scripts/lib/markers.mjs, printed under SAMPLES.md and in the overview app);
// here it did not, so the samples dialog, the catalogue and every sample page
// printed two letters in brackets that nothing on the site explained.
//
// So the marker is taken OFF the text where it is shown and said as words, as
// a badge with the long reading for a tooltip. The index keeps the text as the
// repository wrote it: it is a contract with three repositories and with the
// agents that read samples/apps.json, and a reader of that file has the legend
// in samples/llms.txt. The meanings below are that repository's own wording.

export const MARKS = {
  A: {
    label: "frontend action",
    title: "Performs a frontend action: client->follow_up_action( ), or drag and drop",
  },
  C: {
    label: "custom control",
    title: "Uses an abap2UI5 custom control (the z2ui5.cc namespace)",
  },
};

// Exactly the three markers, at the very end. Anything that only looks like
// one - `(a)`, `(C,A)`, a bracket in the middle - is the author's own text.
const MARKER = /\s*\((A|C|A,\s?C)\)\s*$/;

/**
 * A title or a note without its marker, and the marks it carried in the
 * order A, C - `{ text: "Drag and Drop Nodes", marks: ["A", "C"] }`.
 * @param {unknown} value
 * @returns {{ text: string, marks: string[] }}
 */
export function splitMarks(value) {
  const text = typeof value === "string" ? value : "";
  const found = MARKER.exec(text);
  if (!found) return { text, marks: [] };
  return { text: text.slice(0, found.index), marks: found[1].split(",").map((m) => m.trim()) };
}

/** Both of a row's texts at once, their marks merged: the marker is on the
 *  DESCRIPT, which is the title of one kind of row and the note of another. */
export function marksOf(...values) {
  const marks = new Set();
  const texts = values.map((value) => {
    const split = splitMarks(value);
    for (const m of split.marks) marks.add(m);
    return split.text;
  });
  return { texts, marks: Object.keys(MARKS).filter((m) => marks.has(m)) };
}
