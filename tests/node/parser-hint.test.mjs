// The question the playground adds to abaplint's parser error
// (src/editor/parser-hint.mjs): asked when the shape says a full stop is
// missing, and only then. The browser spec in tests/insight.spec.js drives the
// same code through abaplint and the Problems list; these hold the shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { borrowedSyntax, codeOf, explainDiagnostic, missingFullStop, statementAt } from "../../src/editor/parser-hint.mjs";

const NOT_A_STATEMENT = 'Statement does not exist in the configured ABAP version(or a parser error), "DATA"';
const at = (line) => ({ code: "parser_error", message: NOT_A_STATEMENT, range: { start: { line, character: 4 } } });

const METHOD = [
  "  METHOD run.",
  "    DATA lv_a TYPE i.",
  "    DATA lv_b TYPE i",
  "    DATA lv_c TYPE i.",
  "  ENDMETHOD.",
];

test("a statement run into the next one asks about the line without its full stop", () => {
  const said = explainDiagnostic(at(2), METHOD);
  assert.equal(
    said.message,
    'Statement does not exist in the configured ABAP version (or a parser error), "DATA" - is the full stop missing at the end of line 3?',
  );
  assert.deepEqual(said.start, { line: 2, character: "    DATA lv_b TYPE i".length });
});

test("a comment after the line, or a blank line before the next, does not hide it", () => {
  const lines = ['    lv_a = 1 " the first', "", "* a comment line", "    lv_b = 2."];
  assert.equal(missingFullStop(lines, 0), 0);
  assert.equal(explainDiagnostic(at(0), lines).start?.character, "    lv_a = 1".length);
});

test("the line before the statement is asked about when it does not end one", () => {
  const lines = ["    WRITE lv_a", '    " between', "    DATA lv_c TYPE i."];
  assert.equal(missingFullStop(lines, 2), 0);
});

test("a statement over several lines that is wrong for another reason is left as abaplint said it", () => {
  // Continuation lines are indented under the start: one statement, and no
  // full stop is missing - the space is fixed, nothing is added.
  const lines = ["    lv_x = zcl_nowhere=>call(", "        a = 1", "        b = 2 )", "      FOO.", "    lv_y = 1."];
  assert.equal(missingFullStop(lines, 0), undefined);
  const said = explainDiagnostic(at(0), lines);
  assert.equal(said.message, 'Statement does not exist in the configured ABAP version (or a parser error), "DATA"');
  assert.equal(said.start, undefined);
});

test("a chain's commas and colon are not missing full stops", () => {
  const lines = ["    DATA: lv_a TYPE i,", "          lv_b TYPE zzz yyy.", "    lv_a = 1."];
  assert.equal(missingFullStop(lines, 0), undefined);
});

test("other rules' messages keep their text", () => {
  const other = { code: "check_syntax", message: "lv_c not found", range: { start: { line: 3, character: 4 } } };
  assert.deepEqual(explainDiagnostic(other, METHOD), { message: "lv_c not found" });
});

test("a quote inside a literal or a template is text, not a comment", () => {
  assert.equal(codeOf(`    lv = 'say "hi"'. " done`), `    lv = 'say "hi"'.`);
  assert.equal(codeOf('    lv = |a "b" { c }|'), '    lv = |a "b" { c }|');
  assert.equal(codeOf("* all comment."), "");
});

// What another language spells differently (borrowedSyntax( )): each shape
// below is one abaplint refuses with a bare "Statement does not exist" -
// the words a language model is most often stuck on.
const refused = (line) => ({
  code: "parser_error",
  message: `Statement does not exist in the configured ABAP version(or a parser error), "${line.trim().split(/\s/)[0]}"`,
  range: { start: { line: 0, character: 4 } },
});

test("CDS type notation, TOP and LIMIT, != , ++ and ELSE IF are each said in ABAP's words", () => {
  const cases = [
    ["    DATA lv_c TYPE abap.char(20).", /TYPE c LENGTH 20/],
    ["    SELECT * FROM t100 INTO TABLE @DATA(lt) TOP 10.", /UP TO n ROWS/],
    ["    SELECT * FROM t100 INTO TABLE @DATA(lt) LIMIT 5.", /no LIMIT n/],
    ["    IF lv_a != lv_b.", /<> \(or NE\)/],
    ["    lv_i++.", /no \+\+ or --/],
    ["    ELSE IF lv_a = 2.", /ELSEIF as one word/],
  ];
  for (const [line, hint] of cases) assert.match(explainDiagnostic(refused(line), [line]).message, hint, line);
});

test("a statement over several lines is read to its full stop, and nothing inside a literal or comment counts", () => {
  const lines = ["    SELECT *", "      FROM t100", "      INTO TABLE @DATA(lt)", "      TOP 10."];
  assert.match(explainDiagnostic(refused(lines[0]), lines).message, /UP TO n ROWS/);
  assert.equal(statementAt(["    lv = `a != b` \" a != b", "      && 'TOP 10'."], 0), "lv = '' && ''.");
  for (const line of ["    lv = `x != y` foo.", "    lv = |abap.char( 20 )| bar.", '    lv = 1 " lv++']) {
    assert.equal(borrowedSyntax(statementAt([line], 0)), undefined, line);
  }
  // The full stop comes first: a statement run into the next is asked about
  // the full stop, not about a word in the next one.
  assert.match(explainDiagnostic(refused("    DATA lv_a TYPE i"), ["    DATA lv_a TYPE i", "    lv_a++."]).message, /full stop/);
});
