// Colour for the ABAP the sample pages print, decided at BUILD time.
//
// The per-sample pages are static documents (tools/sample-pages.mjs says why):
// the only scripts on one are the theme read and the loader behind its demo
// box, so a highlighter that runs in the reader's browser is not one of them.
// This one runs here instead: it takes the class as it stands in its
// repository and returns the HTML for it, already escaped, with the same token
// classes the bottom panel's own highlighter emits (src/shell/highlight.mjs).
// One palette for both, defined once in the stylesheets.
//
// It is a SCANNER, not a parser. Five things are worth a colour in a class a
// reader is skimming - a comment, a literal, a number, a keyword and
// everything else - and none of them needs to know what statement it is in.
// A parser would be a second abaplint next to the one this repository already
// depends on, and it would be wrong in a more expensive way when it was wrong.
//
// The one rule that is not about colour: every character of the source goes
// through esc( ) before it goes anywhere near a template literal. What is
// printed here is somebody else's committed file, and a highlighter that
// assembled markup out of it would be one careless line away from putting a
// <script> from a sample repository into these pages.

/* The words ABAP writes its statements with. Not the full language - a
 * keyword list is a reading aid, and one that is a hundred words short simply
 * leaves a hundred words in the body colour. What it must not do is claim a
 * word that is usually a NAME, which is why `id`, `name`, `value`, `key`,
 * `text`, `line`, `type` (as in `TYPE`, kept - it is a statement word before
 * it is anything else) are the judgement calls in it. */
const KEYWORDS = new Set(`
ABSTRACT ADD AND APPEND ARITHMETIC AS ASCENDING ASSIGN ASSIGNING AT
BEGIN BETWEEN BINARY BOUND BY
CALL CASE CASTING CATCH CHANGING CHECK CLASS CLEAR CLOSE COLLECT COMMIT
CONCATENATE COND CONDENSE CONSTANTS CONTINUE CONV CORRESPONDING CREATE
DATA DEFAULT DEFINITION DELETE DESCENDING DESCRIBE DO DURATION
ELSE ELSEIF EMPTY END ENDCASE ENDCATCH ENDCLASS ENDDO ENDENHANCEMENT ENDFORM
ENDFUNCTION ENDIF ENDINTERFACE ENDLOOP ENDMETHOD ENDMODULE ENDON ENDSELECT
ENDTRY ENDWHILE EQ EVENT EVENTS EXCEPTION EXCEPTIONS EXIT EXPORTING EXTENDED
FIELD FIELDS FINAL FOR FORM FREE FRIENDS FROM FUNCTION
GE GET GLOBAL GROUP GT
HANDLE HANDLER
IF IMPLEMENTATION IMPORTING IN INCLUDE INDEX INHERITING INITIAL INSERT
INSTANCE INTERFACE INTERFACES INTO IS
JOIN
KEY
LE LEAVE LENGTH LET LIKE LINES LOCAL LOOP LOWER LT
MESSAGE METHOD METHODS MODIFY MODULE MOVE
NE NEW NEXT NO NOT
OF OFFSET ON OPTIONAL OR ORDER OTHERS
PARAMETERS PERFORM PRIVATE PROTECTED PUBLIC
RAISE RAISING READ RECEIVING REDEFINITION REDUCE REF REFERENCE REPLACE REPORT
RESULT RESUMABLE RETURN RETURNING RISK ROLLBACK
SECTION SELECT SELECTION SET SHIFT SORT SORTED SPLIT STANDARD STATICS STRUCTURE
SUBTRACT
SUPER SWITCH
TABLE TABLES TEST TESTING THEN TIMES TO TRANSPORTING TRY TYPE TYPES
UNASSIGN UNIQUE UNTIL UP UPPER USING
VALUE
WHEN WHERE WHILE WITH WRITE
`.trim().split(/\s+/));

const esc = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const span = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;

/* One pass per line, longest match first, and the order of the alternatives is
 * the whole of the escaping story a scanner like this has: a literal is read
 * before a quote can start a comment, so a `"` inside 'a text' is text, and a
 * `'` inside a comment is part of the comment. */
const TOKENS = new RegExp(
  [
    "'(?:[^']|'')*'?", // 'a text', doubled quote inside, unterminated at EOL
    "`(?:[^`]|``)*`?", // `a text`, which is what a builder chain is written in
    "\\|(?:\\\\.|[^|\\\\])*\\|?", // |a string template { with_this } in it|
    '"[^\\n]*', // a comment to the end of the line
    "[A-Za-z_/][A-Za-z0-9_/]*", // a word: a keyword, or a name
    "\\d+(?:\\.\\d+)?", // a number
  ].join("|"),
  "g",
);

function line(text) {
  // A `*` in the first column comments out the whole line, whatever is on it.
  if (text.startsWith("*")) return span("code-comment", text);

  let out = "";
  let at = 0;
  for (const match of text.matchAll(TOKENS)) {
    const token = match[0];
    if (match.index > at) out += esc(text.slice(at, match.index));
    at = match.index + token.length;

    const head = token[0];
    if (head === '"') out += span("code-comment", token);
    else if (head === "'" || head === "`" || head === "|") out += span("code-string", token);
    else if (head >= "0" && head <= "9") out += span("code-number", token);
    else if (KEYWORDS.has(token.toUpperCase())) out += span("code-key", token);
    else out += esc(token);
  }
  return out + esc(text.slice(at));
}

/* The class as HTML: escaped, coloured, and otherwise exactly as committed -
 * one string per line, because the page wraps each of them in an element of
 * its own (an id and a numbered link, so a passage of a sample has an
 * address). Joining them back with "\n" is the whole of the old shape. */
export function highlightAbapLines(code) {
  return String(code).split("\n").map(line);
}
