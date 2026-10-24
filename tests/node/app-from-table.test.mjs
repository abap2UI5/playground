// "→ App" without a browser (src/editor/app-from-table.mjs): the class it
// writes for a table - its name, its SQL and its view in the house layout. The
// browser test (tests/app-from-table.spec.js) runs what it writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { appFromTable } from "../../src/editor/app-from-table.mjs";
import { starterTable } from "../../src/editor/tables.mjs";

const { checkAbapSource } = createRequire(import.meta.url)("@abap2ui5/linter");

const TABLE = starterTable().table.source;

test("the class is named after the table, and a name already open is not reused", () => {
  assert.equal(appFromTable(TABLE).className, "zcl_zproducts_app");
  assert.equal(appFromTable(TABLE, ["zcl_zproducts_app.clas.abap"]).className, "zcl_zproducts_app2");
});

test("it reads, writes and deletes the rows by the table's key, its client its own", () => {
  const { source } = appFromTable(TABLE).file;
  assert.match(source, /SELECT \* FROM zproducts INTO TABLE @mt_rows ORDER BY PRIMARY KEY\./);
  assert.match(source, /ms_row-mandt = sy-mandt\./);
  // DELETE by a WHERE on the key, never FROM a work area: the playground's
  // database deletes every row for that (docs/design/build-traps.md).
  assert.match(source, /DELETE FROM zproducts WHERE product_id = @row-product_id\.\n\s+COMMIT WORK AND WAIT\./);
  // abap2UI5 rolls back what a roundtrip leaves uncommitted.
  assert.equal(source.match(/COMMIT WORK AND WAIT\./g).length, 2);
  assert.doesNotMatch(source, /DELETE zproducts FROM/);
  // The client is the system's, not a column or an input.
  assert.doesNotMatch(source, /\{MANDT\}|ms_row-mandt \)/);
});

test("the views are in the house layout", () => {
  const { source } = appFromTable(TABLE).file;
  const findings = checkAbapSource(source, { minUi5: "1.71", distribution: "openui5", rules: { "chain-house-layout": "error" } }).findings;
  assert.deepEqual(findings.map((f) => `${f.line}: ${f.message}`), []);
});

test("a table that is not whole yet is a problem, not a class", () => {
  const { file, problem } = appFromTable("<abapGit></abapGit>");
  assert.equal(file, undefined);
  assert.match(problem, /^The table is not whole yet/);
});
