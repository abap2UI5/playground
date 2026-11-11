// File names (src/editor/files.mjs): the metadata header the editor folds, and
// the file set renamed after the class it declares - the way out the Log
// offers when somebody pasted their own class over the open one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { headerEnd, renamedFiles } from "../../src/editor/files.mjs";

test("the header is the leading block of two or more `\" @` lines", () => {
  assert.equal(headerEnd(['" @keywords a b', '" @summary c', '" @docs d', "CLASS x DEFINITION PUBLIC."]), 3);
  assert.equal(headerEnd(['  " @keywords a', '" @summary c', ""]), 2);
});

test("one line, a plain comment or a header further down is no header", () => {
  assert.equal(headerEnd(['" @keywords a', "CLASS x DEFINITION PUBLIC."]), 0);
  assert.equal(headerEnd(['" a comment', '" @summary c', '" @docs d']), 0);
  assert.equal(headerEnd(["CLASS x DEFINITION PUBLIC.", '" @keywords a', '" @docs d']), 0);
  assert.equal(headerEnd([]), 0);
});

const APP = { name: "z2ui5_cl_smp_app_494.clas.abap", source: "CLASS zcl_probe DEFINITION PUBLIC." };
const TESTS = { name: "z2ui5_cl_smp_app_494.clas.testclasses.abap", source: "CLASS ltcl DEFINITION FOR TESTING." };
const OTHER = { name: "zcl_other.clas.abap", source: "CLASS zcl_other DEFINITION PUBLIC." };

test("the file takes the declared name, its test include with it, the order stays", () => {
  const renamed = renamedFiles([APP, TESTS, OTHER], APP.name, "ZCL_PROBE");
  assert.equal(renamed.to, "zcl_probe.clas.abap");
  assert.deepEqual(renamed.files.map((f) => f.name), [
    "zcl_probe.clas.abap",
    "zcl_probe.clas.testclasses.abap",
    "zcl_other.clas.abap",
  ]);
  assert.equal(renamed.files[0].source, APP.source);
});

test("an interface stays an interface", () => {
  const intf = { name: "zif_old.intf.abap", source: "INTERFACE zif_new PUBLIC." };
  assert.equal(renamedFiles([APP, intf], intf.name, "ZIF_NEW").to, "zif_new.intf.abap");
});

test("no clean answer, no offer", () => {
  // Taken by another open file.
  assert.equal(renamedFiles([APP, OTHER], APP.name, "ZCL_OTHER"), undefined);
  // Not an abapGit name (a namespace).
  assert.equal(renamedFiles([APP], APP.name, "/ABC/CL_X"), undefined);
  // A test include is not renamed on its own, nor is a table.
  assert.equal(renamedFiles([APP, TESTS], TESTS.name, "ZCL_X"), undefined);
  assert.equal(renamedFiles([{ name: "zt.tabl.xml", source: "" }], "zt.tabl.xml", "ZX"), undefined);
  // Already right.
  assert.equal(renamedFiles([OTHER], OTHER.name, "ZCL_OTHER"), undefined);
});
