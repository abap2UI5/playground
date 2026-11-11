// tableFiles( ) (src/editor/tables.mjs): the AI App Builder's write_table
// input turned into the two files "+ table" writes - and every input it
// refuses, said so the model can correct it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSeed, readTable, tableFiles } from "../../src/editor/tables.mjs";

test("fields and rows become a definition the checker reads and rows the runtime inserts", () => {
  const made = tableFiles({
    name: "zorders",
    description: "Orders of the order app",
    fields: [
      { name: "order_id", type: "CHAR", length: 10, key: true },
      { name: "amount", type: "DEC", length: 13, decimals: 2 },
      { name: "created", type: "DATS" },
      { name: "note", type: "STRG" },
    ],
    rows: [{ order_id: "A1", amount: 12.5, created: "20261111" }, { ORDER_ID: "A2", amount: "7" }],
  });
  assert.equal(made.error, undefined);
  assert.equal(made.table.name, "zorders.tabl.xml");
  assert.equal(made.seed.name, "zorders.tabu.json");
  const table = readTable(made.table.source);
  assert.deepEqual(table.problems, []);
  assert.equal(table.name, "ZORDERS");
  // MANDT first, added by itself; the keys lead.
  assert.deepEqual(table.fields.map((f) => [f.name, f.key]), [["MANDT", true], ["ORDER_ID", true], ["AMOUNT", false], ["CREATED", false], ["NOTE", false]]);
  assert.match(made.table.source, /<DDTEXT>Orders of the order app<\/DDTEXT>/);
  assert.match(made.table.source, /<DATATYPE>DEC<\/DATATYPE>\s*<LENG>000013<\/LENG>\s*<DECIMALS>000002<\/DECIMALS>/);
  assert.match(made.table.source, /<DATATYPE>DATS<\/DATATYPE>\s*<LENG>000008<\/LENG>/);
  const seed = parseSeed(made.seed.source);
  assert.deepEqual(seed.problems, []);
  assert.deepEqual(seed.rows, [{ ORDER_ID: "A1", AMOUNT: 12.5, CREATED: "20261111" }, { ORDER_ID: "A2", AMOUNT: "7" }]);
});

test("a table without rows starts empty, and a MANDT the model listed is not listed twice", () => {
  const made = tableFiles({ name: "ylog", fields: [{ name: "MANDT", type: "CLNT" }, { name: "id", type: "INT4", key: true }] });
  assert.equal(made.error, undefined);
  assert.equal(made.seed.source, "[]\n");
  assert.deepEqual(readTable(made.table.source).fields.map((f) => f.name), ["MANDT", "ID"]);
});

test("what it refuses, it says how to correct", () => {
  const refused = (input) => tableFiles(input).error;
  assert.match(refused({ name: "vbak", fields: [{ name: "a", type: "CHAR", length: 1, key: true }] }), /z or y first/);
  assert.match(refused({ name: "z_a_name_far_too_long", fields: [] }), /at most 16/);
  assert.match(refused({ name: "zt", fields: [] }), /needs fields/);
  assert.match(refused({ name: "zt", fields: [{ name: "a", type: "CHAR", length: 3 }] }), /at least one key/);
  assert.match(refused({ name: "zt", fields: [{ name: "a", type: "CHAR", key: true }] }), /needs a length/);
  assert.match(refused({ name: "zt", fields: [{ name: "a", type: "CURR", length: 3, key: true }] }), /one of CHAR/);
  assert.match(refused({ name: "zt", fields: [{ name: "a", type: "STRG", key: true }] }), /cannot be key/);
  assert.match(refused({ name: "zt", fields: [{ name: "a", type: "DEC", length: 5, decimals: 9, key: true }] }), /0 to 4 decimals/);
  assert.match(refused({ name: "zt", fields: [{ name: "a", type: "CHAR", length: 3 }, { name: "b", type: "CHAR", length: 3, key: true }] }), /key fields come first/);
  assert.match(refused({ name: "zt", fields: [{ name: "a", type: "CHAR", length: 3, key: true }, { name: "A", type: "INT4" }] }), /twice/);
  assert.match(refused({ name: "zt", fields: [{ name: "a", type: "CHAR", length: 3, key: true }], rows: [{ b: 1 }] }), /no field B/);
  assert.match(refused({ name: "zt", fields: [{ name: "a", type: "CHAR", length: 3, key: true }], rows: [{ a: { x: 1 } }] }), /string, a number or a boolean/);
  assert.match(refused({ name: "zt", fields: [{ name: "a", type: "CHAR", length: 3, key: true }], rows: Array.from({ length: 1001 }, () => ({})) }), /at most 1000/);
});

test("a description cannot break the XML it is written into", () => {
  const made = tableFiles({ name: "zt", description: "Orders <&> more", fields: [{ name: "a", type: "CHAR", length: 3, key: true }] });
  assert.match(made.table.source, /<DDTEXT>Orders {5}more<\/DDTEXT>/);
  assert.deepEqual(readTable(made.table.source).problems, []);
});
