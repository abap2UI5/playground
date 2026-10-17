// Format's spacing, without a browser: formatFiles( ) in
// src/editor/registry-core.mjs is plain abaplint and needs no worker, so what
// it does to a run of spaces is held here in milliseconds. tests/format.spec.js
// drives the same function through the bar's button and the key.
//
// The question these answer is "does Format fold EVERY double space?", and the
// answer is no, on purpose. abaplint's double_space rule - the one on the
// FORMAT_RULES list - folds a run AFTER a keyword or a bracket, and nothing in
// front of one. `me->client    =   client.` comes back as
// `me->client    = client.`, and that is the house layout rather than half a
// fix: padding in front of an `=`, a `TYPE` or a parameter name is how
// abap2UI5's own samples line up a block of assignments, a structure's
// components and a builder chain's `v =` column - `me->client     = client.`
// is written that way in samples upstream - and a run of spaces cannot say
// whether it lines something up three lines away. Folding all of them was
// tried against the pinned samples: it rewrote 2,300 lines in 211 of 357
// classes, which is a formatter that reformats the house style.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatFiles } from "../../src/editor/registry-core.mjs";

const NAME = "zcl_spacing.clas.abap";

/** The class around a method body, already in the printer's layout. */
const classWith = (body) => `CLASS zcl_spacing DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    DATA client TYPE string.
    DATA name   TYPE string.
    METHODS main IMPORTING client TYPE string.

ENDCLASS.


CLASS zcl_spacing IMPLEMENTATION.

  METHOD main.
${body.map((line) => `    ${line}`).join("\n")}
  ENDMETHOD.

ENDCLASS.
`;

const format = (source) => {
  const { files } = formatFiles([{ name: NAME, source }]);
  return files.length === 0 ? source : files[0].source;
};

test("a run after a keyword or an = folds to one space", () => {
  const out = format(classWith(["DATA(x) =   1.", "IF  x = 1.", "ENDIF."]));
  assert.match(out, /DATA\(x\) = 1\./);
  assert.match(out, /IF x = 1\./);
});

test("padding in front of an = stays: it is how the house lines assignments up", () => {
  // The case a reader reports as "half fixed". The run after the = goes, the
  // one in front of it is alignment and stays - on a line of its own as in a
  // block, because one run cannot tell which it is.
  const out = format(classWith(["me->client    =   client."]));
  assert.match(out, /me->client {4}= client\./);

  const block = classWith(["me->client = client.", "name       = client."]);
  assert.equal(format(block), block);
});

test("aligned declarations come back as they were", () => {
  const source = classWith(["name = client."]);
  assert.match(source, /DATA name {3}TYPE string\./);
  assert.equal(format(source), source);
});

test("the sample the page opens on - a builder chain in the house layout - is already formatted", () => {
  // The chain's `v =` column is padding in front of a parameter name, the
  // same padding as above: Format has to give it back byte for byte.
  const source = readFileSync(new URL("fixtures/binding.clas.abap", import.meta.url), "utf8");
  assert.ok(/\)->a\( n = `\w+` +v = /.test(source), "the fixture still lines a chain up");
  assert.equal(formatFiles([{ name: "z2ui5_cl_smp_app_494.clas.abap", source }]).formatted, 0);
});
