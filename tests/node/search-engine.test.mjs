// The matcher under the bar's search box (src/shell/search-engine.mjs), over
// a handful of entries in the shape of the docs' search-index.json. Each case
// is one of the sentences in the module's own comments, run: the stop words,
// the plural, the title that beats a mention, every word required, and the
// two ways a query that finds nothing is relaxed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { grouped, highlight, queryTerms, search } from "../../src/shell/search-engine.mjs";

const ENTRIES = [
  { area: "docs", group: "Documentation", title: "Installation", text: "How to install abap2UI5 with abapGit.", headings: [["Requirements", "requirements"]] },
  { area: "docs", group: "Documentation", title: "Tables", text: "Show an internal table, sort it in the backend.", headings: [["Sorting", "sorting"]] },
  { area: "docs", group: "Documentation", title: "Client API", text: "check_on_init, view_display and the rest.", headings: [["view_display", "view-display"]] },
  { area: "docs", group: "Documentation", title: "ABAP Cloud", text: "Runs on ABAP Cloud and on-premise.", headings: [] },
  { area: "samples", group: "Samples", title: "Label and Input", code: "z2ui5_cl_smp_app_001", text: "A Label beside an Input.", terms: "form" },
  { area: "samples", group: "Samples", title: "Table with sorting", code: "z2ui5_cl_smp_app_002", text: "A sap.m.Table.", terms: "list" },
  { area: "samples", group: "Samples", title: "Message Box", code: "z2ui5_cl_smp_app_003", text: "Build a confirmation.", terms: "popup" },
  { area: "samples", group: "Samples", title: "Toolchain - abap-cleaner", code: "z2ui5_cl_smp_app_004", text: "Formatting in the cloud.", terms: "" },
];

const titles = (hits) => hits.map((h) => h.entry.title);

test("a query is split the way the index was, without the words that decide nothing", () => {
  assert.deepEqual(queryTerms("how do i install"), ["install"]);
  // A query that is ONLY stop words still searches for what it says.
  assert.deepEqual(queryTerms("is it"), ["is", "it"]);
  // Pasted ABAP: the dot and the underscore stay inside a word.
  assert.deepEqual(queryTerms("client->view_display( )"), ["client", "view_display"]);
  assert.deepEqual(queryTerms("sap.m.Table"), ["sap.m.table"]);
  // The plural is the singular; not from `ss`, not from a short word.
  assert.deepEqual(queryTerms("tables class bus"), ["table", "class", "bus"]);
  // Lower-cased without changing the length - the Turkish capital I.
  assert.deepEqual(queryTerms("İNPUT"), ["input"]);
  assert.deepEqual(queryTerms("  "), []);
});

test("a title hit outranks a mention, and every word has to be found", () => {
  assert.equal(titles(search(ENTRIES, "install"))[0], "Installation");
  assert.equal(titles(search(ENTRIES, "tables"))[0], "Tables");
  // Two words narrow: only the entry that has both.
  assert.deepEqual(titles(search(ENTRIES, "label input")), ["Label and Input"]);
  // The phrase as typed, as a title, beats a title hit on one of the words.
  assert.equal(titles(search(ENTRIES, "abap cloud"))[0], "ABAP Cloud");
  assert.deepEqual(search(ENTRIES, ""), []);
});

test("the section is offered when a heading matched", () => {
  const [hit] = search(ENTRIES, "sorting backend");
  assert.equal(hit.entry.title, "Tables");
  assert.deepEqual([hit.heading.text, hit.heading.anchor], ["Sorting", "sorting"]);
});

test("a class name is found by its prefix", () => {
  assert.equal(titles(search(ENTRIES, "z2ui5_cl_smp_app_003"))[0], "Message Box");
  // "messagebox" closed up finds the two-word title.
  assert.equal(titles(search(ENTRIES, "messagebox"))[0], "Message Box");
});

test("a short term counts at a word start only", () => {
  // `ui` is inside "Build" and inside nothing else here.
  assert.deepEqual(titles(search(ENTRIES, "ui")), []);
});

test("nothing found: a word too many is set aside, a typo corrected - and said so", () => {
  const extra = search(ENTRIES, "table sort zebra");
  assert.ok(extra.length > 0);
  assert.equal(extra.relaxedTo, "table sort");

  const typo = search(ENTRIES, "tabel");
  assert.equal(typo.relaxedTo, "table");
  assert.ok(titles(typo).includes("Tables"));

  assert.deepEqual(search(ENTRIES, "qqqqqq"), []);
});

test("the hits are grouped, the documentation first when it has a real answer", () => {
  const groups = grouped(search(ENTRIES, "table"), { perGroup: 1 });
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Documentation", "Samples"],
  );
  assert.equal(groups[0].hits.length, 1);
  assert.ok(groups.every((g) => g.total >= g.hits.length));
});

test("highlight marks what was matched, and nothing it was not", () => {
  assert.deepEqual(highlight("Tables and lists", "tables"), [
    ["Table", true],
    ["s and lists", false],
  ]);
  // Stop words are not marked.
  assert.deepEqual(highlight("How to install", "how to install"), [
    ["How to ", false],
    ["install", true],
  ]);
  // A two-letter term at a word start only - not the "ui" in "Build".
  assert.deepEqual(highlight("Build guide UI", "ui"), [
    ["Build guide ", false],
    ["UI", true],
  ]);
  // Overlapping terms merge into one mark.
  assert.deepEqual(highlight("view_display", "view view_display"), [["view_display", true]]);
  assert.deepEqual(highlight("", "x"), [["", false]]);
  assert.deepEqual(highlight("text", ""), [["text", false]]);
});
