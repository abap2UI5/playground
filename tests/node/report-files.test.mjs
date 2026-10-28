// A classic report and its text pool as files of the editor: the names
// src/editor/files.mjs takes for them, and the set a link or a draft may
// bring - a report first, its text pool beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkFileSet, dependentsOf, isReportFile, nameProblem, ownerFileOf, parseName,
} from "../../src/editor/files.mjs";

test("a report and its text pool are one object", () => {
  assert.deepEqual(parseName("zr2c_hello.prog.abap"), { object: "ZR2C_HELLO", kind: "prog" });
  assert.deepEqual(parseName("zr2c_hello.prog.xml"), { object: "ZR2C_HELLO", kind: "prog", include: "textpool" });
  assert.equal(isReportFile("zr2c_hello.prog.abap"), true);
  assert.equal(isReportFile("zr2c_hello.prog.xml"), false);
  assert.equal(isReportFile("zcl_x.clas.abap"), false);
});

test("the text pool belongs to its report, and goes when the report is closed", () => {
  assert.equal(ownerFileOf("zr2c_hello.prog.xml"), "zr2c_hello.prog.abap");
  assert.deepEqual(dependentsOf("zr2c_hello.prog.abap"), ["zr2c_hello.prog.xml"]);
  assert.match(nameProblem("zr2c_hello.prog.xml", []), /text pool of zr2c_hello\.prog\.abap/);
  assert.equal(nameProblem("zr2c_hello.prog.xml", ["zr2c_hello.prog.abap"]), undefined);
});

test("a report can be the first file, its text pool cannot", () => {
  const report = { name: "zr2c_hello.prog.abap", source: "REPORT zr2c_hello." };
  const pool = { name: "zr2c_hello.prog.xml", source: "<abapGit/>" };
  assert.deepEqual(checkFileSet([report, pool]), [report, pool]);
  assert.throws(() => checkFileSet([pool, report]), /class or a report/);
});
