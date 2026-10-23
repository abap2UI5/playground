// The AI Studio's target system (src/shell/target-system.mjs): the releases
// the chat header offers, which must be releases abaplint knows, and the
// TODO(system) lines the download lists. tests/ai.spec.js drives both
// through the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Version } from "@abaplint/core";
import { DEFAULT_TARGET, TARGETS, TODO_MARK, functionCalls, systemTodos, targetLabel, targetRules, uncheckedCallsText } from "../../src/shell/target-system.mjs";

test("every target is a release abaplint knows, and the default is one of them", () => {
  const known = Object.values(Version);
  for (const target of TARGETS) assert.ok(known.includes(target.version), target.version);
  assert.ok(TARGETS.some((t) => t.version === DEFAULT_TARGET));
  // The default is the release the editor checks against out of the box
  // (RELEASE in src/editor/registry.mjs).
  assert.equal(DEFAULT_TARGET, "v750");
});

test("a release the header does not list is still told as abaplint names it", () => {
  assert.equal(targetLabel("v702"), "ABAP 7.02 - 7.31");
  assert.equal(targetLabel("v757"), "ABAP v757");
  assert.match(targetRules("v757"), /"v757"/);
  assert.match(targetRules("v702"), /no inline declarations/);
  assert.match(targetRules("Cloud"), /released APIs only/);
});

test("the TODO(system) lines are listed per file and line, whatever their case and spacing", () => {
  const files = [
    {
      name: "zcl_app.clas.abap",
      source: [
        "CLASS zcl_app IMPLEMENTATION.",
        "  METHOD z2ui5_if_app~main.",
        `    " ${TODO_MARK} SELECT from VBAK instead of these rows`,
        "    mt_orders = VALUE #( ( vbeln = `1` ) ).",
        '    "todo(System):   BAPI_MATERIAL_GET_DETAIL - check it is there  ',
        "    \" TODO: an ordinary todo is not the system's",
        `    " ${TODO_MARK}`,
        "  ENDMETHOD.",
      ].join("\r\n"),
    },
    { name: "zcl_helper.clas.abap", source: `" ${TODO_MARK} read the customizing table` },
    { name: "zcl_clean.clas.abap", source: "CLASS zcl_clean DEFINITION. ENDCLASS." },
  ];
  assert.deepEqual(systemTodos(files), [
    { file: "zcl_app.clas.abap", line: 3, text: "SELECT from VBAK instead of these rows" },
    { file: "zcl_app.clas.abap", line: 5, text: "BAPI_MATERIAL_GET_DETAIL - check it is there" },
    { file: "zcl_app.clas.abap", line: 7, text: "" },
    { file: "zcl_helper.clas.abap", line: 1, text: "read the customizing table" },
  ]);
  assert.deepEqual(systemTodos([]), []);
  assert.deepEqual(systemTodos(undefined), []);
});

test("every CALL FUNCTION is found, marked or not, and only the unmarked ones are told to the model", () => {
  const files = [{
    name: "zcl_app.clas.abap",
    source: [
      `    " ${TODO_MARK} the real order list`,
      "",
      "    CALL FUNCTION 'BAPI_SALESORDER_GETLIST'",
      "      EXPORTING customer_number = lv_kunnr.",
      "    call function `Z_MY_MODULE`.",
      "    CALL FUNCTION lv_dynamic.",
      "* CALL FUNCTION 'IN_A_COMMENT_LINE'.",
      `    lv_text = 'CALL FUNCTION in a literal'. " CALL FUNCTION 'AFTER_THE_QUOTE'`,
    ].join("\n"),
  }];
  assert.deepEqual(functionCalls(files), [
    { file: "zcl_app.clas.abap", line: 3, name: "BAPI_SALESORDER_GETLIST", marked: true },
    { file: "zcl_app.clas.abap", line: 5, name: "Z_MY_MODULE", marked: false },
    { file: "zcl_app.clas.abap", line: 6, name: "LV_DYNAMIC", marked: false },
  ]);
  const told = uncheckedCallsText(files);
  assert.match(told, /^not checked here \(2\)/);
  assert.match(told, /zcl_app\.clas\.abap:5 CALL FUNCTION Z_MY_MODULE/);
  assert.doesNotMatch(told, /BAPI_SALESORDER_GETLIST/);
  assert.equal(uncheckedCallsText([{ name: "zcl_clean.clas.abap", source: "CLASS zcl_clean DEFINITION. ENDCLASS." }]), "");
});

test("a TODO(system) in a string literal is text, and a comment line between the mark and the call still marks it", () => {
  const files = [{
    name: "zcl_app.clas.abap",
    source: [
      `    lv_text = '" ${TODO_MARK} not a mark'.`,
      "    CALL FUNCTION 'IT''S_A_MODULE'.",
      `    " ${TODO_MARK} check the BAPI`,
      "    \" the parameters are the customer's",
      "",
      "    CALL FUNCTION 'BAPI_CUSTOMER_GETDETAIL2'.",
      "    lv_x = 1.",
      "    CALL FUNCTION 'Z_AFTER_CODE'.",
    ].join("\n"),
  }];
  assert.deepEqual(systemTodos(files), [{ file: "zcl_app.clas.abap", line: 3, text: "check the BAPI" }]);
  assert.deepEqual(functionCalls(files), [
    { file: "zcl_app.clas.abap", line: 2, name: "IT'S_A_MODULE", marked: false },
    { file: "zcl_app.clas.abap", line: 6, name: "BAPI_CUSTOMER_GETDETAIL2", marked: true },
    { file: "zcl_app.clas.abap", line: 8, name: "Z_AFTER_CODE", marked: false },
  ]);
});
