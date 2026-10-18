// @ts-check
// What abaplint's parser error means, most of the time, said where it shows.
//
// A statement abaplint cannot parse is reported as
//
//   Statement does not exist in the configured ABAP version(or a parser
//   error), "DATA"
//
// and the commonest reason by far is a full stop that is not there: ABAP
// statements end at a full stop, not at the end of a line, so
//
//   DATA lv_b TYPE i
//   DATA lv_c TYPE i.
//
// is ONE statement, "DATA lv_b TYPE i DATA lv_c TYPE i.", which exists in no
// release - reported at the first line, with the name of its first word and a
// row of follow-on errors about lv_c, which was never declared. Nothing in
// the message mentions a full stop, and somebody new to ABAP reads it as
// "DATA does not exist in this version".
//
// So the playground adds the question to the message where the shape says so,
// and moves the Problems row to the line that wants the full stop. abaplint
// itself is not patched: the rule's message is its own, and a heuristic about
// a missing full stop is a presentation of it, not a finding. The heuristic is
// asked only about a statement abaplint already refused, so a guess that is
// wrong costs a question mark, never a false error.

const PARSER_ERROR = "parser_error";
const NOT_A_STATEMENT = /^Statement does not exist in the configured ABAP version/;

// The line as ABAP reads it: without a full-line comment (a `*` in the first
// column) and without a `"` comment at its end - a `"` inside a literal,
// a text template or a string template is text, not a comment.
/** @param {string} line */
export function codeOf(line) {
  if (line.startsWith("*")) return "";
  /** @type {string | undefined} */
  let quote;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === "'" || c === "`" || c === "|") quote = c;
    else if (c === '"') return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

const indentOf = (/** @type {string} */ line) => line.length - line.trimStart().length;
// A line that ends a statement, a chained part of one, or the colon before a chain.
const ends = (/** @type {string} */ code) => /[.,:]$/.test(code);

// The 0-based line that wants a full stop at its end, for a statement that
// starts at `start` - or undefined, when the shape does not say so.
/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {number | undefined}
 */
export function missingFullStop(lines, start) {
  // The line before the statement, if it does not end one: what a statement
  // abaplint started a line too late looks like.
  for (let at = start - 1; at >= 0; at--) {
    const code = codeOf(lines[at]);
    if (code.trim() === "") continue;
    if (!ends(code)) return at;
    break;
  }
  // The usual case: the statement starts on the line without the full stop
  // and runs into the next one. A line that does not end the statement, with
  // the next line of code no further in than the statement's first, is two
  // statements written as one - a continuation is indented under where it
  // started, which is the house layout and what every formatter does.
  const first = indentOf(lines[start] ?? "");
  for (let at = start; at < lines.length && at < start + 40; at++) {
    const code = codeOf(lines[at]);
    if (code.trim() === "") continue;
    if (code.endsWith(".")) return undefined;
    if (ends(code)) continue;
    let next = at + 1;
    while (next < lines.length && codeOf(lines[next]).trim() === "") next++;
    if (next >= lines.length) return undefined;
    if (indentOf(lines[next]) <= first) return at;
  }
  return undefined;
}

// A diagnostic as the page shows it: abaplint's message with its missing space
// put back ("version(or" - a typo in the rule, shown to every reader), and for
// a statement that does not exist, the question about the full stop and the
// place to look - `start`, where the Problems row should go, which is the end
// of the line that wants it.
/**
 * @param {{ code?: unknown, message: string, range: { start: { line: number, character: number } } }} diagnostic
 * @param {string[]} lines
 * @returns {{ message: string, start?: { line: number, character: number } }}
 */
export function explainDiagnostic(diagnostic, lines) {
  const message = diagnostic.message.replace("ABAP version(or", "ABAP version (or");
  if (diagnostic.code !== PARSER_ERROR || !NOT_A_STATEMENT.test(diagnostic.message)) return { message };
  const at = missingFullStop(lines, diagnostic.range.start.line);
  if (at === undefined) return { message };
  return {
    message: `${message} - is the full stop missing at the end of line ${at + 1}?`,
    start: { line: at, character: codeOf(lines[at]).length },
  };
}
