// A table of the reader's own (src/editor/tables.mjs): the seed file's rows,
// the check that keeps a half-typed definition from abaplint, the starter
// pair, and where the two files land in an abapGit export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ROWS, dataConfig, parseSeed, readTable, starterTable, tableXml } from "../../src/editor/tables.mjs";
import { checkFileSet, dependentsOf, nameProblem, ownerFileOf, parseName, sidecarFor, skeletonFor } from "../../src/editor/files.mjs";
import { abapGitEntries } from "../../src/shell/export.mjs";

test("a seed file is a JSON array of rows, field names in any case", () => {
  const { rows, problems } = parseSeed('[\n  { "id": "A", "Price": 1.5, "flag": true, "gone": null },\n  { "ID": "B", "flag": false }\n]');
  assert.deepEqual(problems, []);
  assert.deepEqual(rows, [
    { ID: "A", PRICE: 1.5, FLAG: "X" },
    { ID: "B", FLAG: "" },
  ]);
});

test("an empty seed file is no rows, not an error", () => {
  assert.deepEqual(parseSeed("  \n"), { rows: [], problems: [] });
  assert.deepEqual(parseSeed("[]"), { rows: [], problems: [] });
});

test("a seed file that is not JSON says so at the line it broke on", () => {
  const { rows, problems } = parseSeed('[\n  { "id": "A" },\n  { "id": "B", }\n]');
  assert.deepEqual(rows, []);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 3);
  assert.match(problems[0].message, /^This is not JSON/);
});

test("a seed file of the wrong shape names the row", () => {
  assert.match(parseSeed('{ "id": "A" }').problems[0].message, /JSON array/);
  const { problems } = parseSeed('[\n  { "id": "A" },\n  "B",\n  {\n    "id": { "x": 1 }\n  }\n]');
  assert.deepEqual(
    problems.map((p) => [p.line, p.message]),
    [
      [3, "Row 2 is not an object of field names and values."],
      [4, "Row 3, ID: a value is a string or a number, not an object."],
    ],
  );
});

test("a seed file holds a bounded number of rows", () => {
  const many = JSON.stringify(Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({ id: String(i) })));
  assert.match(parseSeed(many).problems[0].message, new RegExp(`at most ${MAX_ROWS}`));
});

test("the starter table reads back whole, and its rows parse", () => {
  const { table, seed } = starterTable();
  assert.equal(table.name, "zproducts.tabl.xml");
  assert.equal(seed.name, "zproducts.tabu.json");
  const read = readTable(table.source);
  assert.deepEqual(read.problems, []);
  assert.equal(read.name, "ZPRODUCTS");
  assert.deepEqual(read.fields.map((f) => [f.name, f.key]), [
    ["MANDT", true],
    ["PRODUCT_ID", true],
    ["NAME", false],
    ["CATEGORY", false],
    ["PRICE", false],
    ["STOCK", false],
  ]);
  const rows = parseSeed(seed.source);
  assert.deepEqual(rows.problems, []);
  assert.equal(rows.rows.length, 5);
  assert.equal(rows.rows[1].NAME, "Monitor 27");
});

test("a definition abaplint would throw on is caught first, at its field", () => {
  const xml = tableXml("ztab");
  assert.deepEqual(readTable(xml).problems, []);
  const untyped = xml.replace("<DATATYPE>CHAR</DATATYPE>", "");
  const [problem] = readTable(untyped).problems;
  assert.match(problem.message, /^ID has no type/);
  assert.equal(untyped.split("\n")[problem.line - 1].trim(), "<DD03P>");
  const element = xml.replace("     <COMPTYPE>E</COMPTYPE>\n", "");
  assert.match(readTable(element).problems[0].message, /MANDT names the data element MANDT - say so with <COMPTYPE>E<\/COMPTYPE>/);
  assert.match(readTable("<abapGit/>").problems[0].message, /TABL XML/);
});

test("a table's files are named as abapGit names them, the rows belonging to the table", () => {
  assert.deepEqual(parseName("ztab.tabl.xml"), { object: "ZTAB", kind: "tabl" });
  assert.deepEqual(parseName("ztab.tabu.json"), { object: "ZTAB", kind: "tabl", include: "tabu" });
  assert.equal(parseName("ztab.tabl.json"), undefined);
  assert.equal(ownerFileOf("ztab.tabu.json"), "ztab.tabl.xml");
  assert.deepEqual(dependentsOf("ztab.tabl.xml"), ["ztab.tabu.json"]);
  assert.deepEqual(dependentsOf("zcl_a.clas.abap"), ["zcl_a.clas.testclasses.abap"]);
  assert.equal(sidecarFor("ztab.tabl.xml"), undefined);
  assert.equal(sidecarFor("ztab.tabu.json"), undefined);
  assert.match(nameProblem("ztab.tabu.json", [], []), /holds the rows of ztab.tabl.xml, which is not open/);
  assert.equal(nameProblem("ztab.tabu.json", [], ["ztab.tabl.xml"]), undefined);
  assert.match(skeletonFor("ztab.tabl.xml"), /<TABNAME>ZTAB<\/TABNAME>/);
  assert.equal(skeletonFor("ztab.tabu.json"), "[\n]\n");
  const set = [{ name: "zcl_app.clas.abap", source: "" }, { name: "ztab.tabu.json", source: "[]" }, { name: "ztab.tabl.xml", source: "" }];
  assert.equal(checkFileSet(set).length, 3);
});

test("the export puts the definition under src/ and the rows under data/, with abapGit's data config", () => {
  const { table, seed } = starterTable();
  const entries = abapGitEntries([{ name: "zcl_app.clas.abap", source: "CLASS zcl_app DEFINITION PUBLIC.\nENDCLASS.\n" }, table, seed]);
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  assert.ok(byName.get("src/zproducts.tabl.xml").startsWith("\uFEFF<?xml"));
  assert.equal(byName.has("src/zproducts.tabl.xml.xml"), false);
  assert.equal(byName.get("data/zproducts.tabu.json"), seed.source);
  assert.equal(byName.get("data/zproducts.conf.json"), dataConfig("zproducts"));
  assert.deepEqual(JSON.parse(byName.get("data/zproducts.conf.json")), { type: "TABU", name: "ZPRODUCTS", skip_initial: "", where: [] });
  assert.equal(byName.has("src/zproducts.tabu.json"), false);
  assert.match(byName.get("README.md"), /`src\/zproducts.tabl.xml` - ZPRODUCTS, database table/);
  assert.match(byName.get("README.md"), /`data\/zproducts.tabu.json` - the rows of ZPRODUCTS/);
});
