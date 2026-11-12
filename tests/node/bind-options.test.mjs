// src/shell/bind-options.mjs: what the View tab's Properties sheet offers to
// bind a property to, the ABAP it writes, and the arm a new event gets in
// main( ) - steps 3 and 4 of the visual builder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bindingAbap, clientOf, editableByDefault, EVENT_NAME, eventAbap, publicAttributes, withEventArm } from "../../src/shell/bind-options.mjs";

const APP = `CLASS zcl_app DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
    " a comment naming DATA fake TYPE string.
    DATA name TYPE string.
    DATA: t_rows TYPE STANDARD TABLE OF zrow WITH EMPTY KEY,
          flag   TYPE abap_bool READ-ONLY,
          other  TYPE REF TO zcl_other.
    DATA total LIKE sy-tabix.
  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
  PRIVATE SECTION.
    DATA secret TYPE string.
ENDCLASS.

CLASS zcl_app IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    me->client = client.
    IF client->check_on_init( ).
      IF name IS INITIAL.
        name = \`x\`.
      ENDIF.
    ELSEIF client->check_on_event( \`SAVE\` ).
      flag = abap_true.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`;

test("the public attributes, in order - chained DATA too, not a reference, not a comment, not the private ones", () => {
  assert.deepEqual(publicAttributes(APP), [
    { name: "name", type: "string", table: false },
    { name: "t_rows", type: "STANDARD TABLE OF zrow WITH EMPTY KEY", table: true },
    { name: "flag", type: "abap_bool", table: false },
    { name: "total", type: "sy-tabix", table: false },
  ]);
  assert.deepEqual(publicAttributes("no class here"), []);
});

test("the client as the chain calls it, and the binding and event ABAP written with it", () => {
  assert.equal(clientOf(APP), "client");
  assert.equal(clientOf("v = me->client->_bind( name )"), "me->client");
  assert.equal(clientOf("nothing bound yet"), "client");
  assert.equal(bindingAbap("client", "name", false), "client->_bind( name )");
  assert.equal(bindingAbap("me->client", "name", true), "me->client->_bind_edit( name )");
  assert.equal(eventAbap("client", "SAY_HI"), "client->_event( `SAY_HI` )");
  assert.ok(editableByDefault("value") && editableByDefault("selected") && !editableByDefault("text"));
  assert.ok(EVENT_NAME.test("SAVE_ALL") && !EVENT_NAME.test("save all") && !EVENT_NAME.test("1A"));
});

test("a new event's arm goes before the dispatching IF's own ENDIF, past a nested one, at its indent", () => {
  const armed = withEventArm(APP, "client", "DELETE");
  assert.equal(armed.ok, true);
  assert.match(armed.source, /flag = abap_true\.\n {4}ELSEIF client->check_on_event\( `DELETE` \)\.\n\n {4}ENDIF\.\n {2}ENDMETHOD\./);
  // The nested IF's ENDIF is not the one.
  assert.match(armed.source, /name = `x`\.\n {6}ENDIF\.\n {4}ELSEIF client->check_on_event\( `SAVE` \)/);
  // An event handled already is left alone.
  assert.equal(withEventArm(APP, "client", "SAVE").source, APP);
  // CRLF stays CRLF.
  const crlf = withEventArm(APP.replaceAll("\n", "\r\n"), "client", "DELETE");
  assert.ok(crlf.ok && !/[^\r]\n/.test(crlf.source));
  // No dispatching IF: a sentence saying what to add.
  const none = withEventArm("CLASS zcl_x IMPLEMENTATION.\n  METHOD z2ui5_if_app~main.\n  ENDMETHOD.\nENDCLASS.\n", "client", "GO");
  assert.equal(none.ok, false);
  assert.match(none.why, /ELSEIF client->check_on_event\( `GO` \)/);
});

test("an attribute is offered for a property whose type it fits", async () => {
  const { bindsTo } = await import("../../src/shell/bind-options.mjs");
  const [name, rows, flag, total] = publicAttributes(APP);
  // A table never binds to a property.
  assert.equal(bindsTo("string", rows), false);
  assert.equal(bindsTo(undefined, rows), false);
  // A boolean property: only the abap_bool.
  assert.equal(bindsTo("boolean", flag), true);
  assert.equal(bindsTo("boolean", name), false);
  // A number: only a numeric type (total is LIKE sy-tabix - not a built-in, so not offered).
  assert.equal(bindsTo("int", { name: "n", type: "i", table: false }), true);
  assert.equal(bindsTo("float", { name: "n", type: "p LENGTH 10 DECIMALS 2", table: false }), true);
  assert.equal(bindsTo("int", name), false);
  assert.equal(bindsTo("int", total), false);
  // Text-like and unknown types: any scalar.
  assert.equal(bindsTo("sap.ui.core.URI", name), true);
  assert.equal(bindsTo(undefined, flag), true);
});
