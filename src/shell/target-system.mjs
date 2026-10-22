// The system the AI Studio's app is for, and what the app still needs from it.
//
// The page checks the ABAP against one release (abaplint's `version`, the
// Config tab's setting) and the model was never told which: it wrote 7.50
// syntax for a reader on 7.02, the check said nothing because it ran at
// v750, and the class failed to activate after the import. So the reader
// picks the target in the chat header, the syntax check moves with it
// (setAbapRelease( ) in agent-hooks.mjs) and the system prompt says what
// that release allows (ai-agent.mjs, playgroundRules).
//
// What the page cannot check at all - a SELECT from a table that only the
// reader's system has, a BAPI or class the model assumed without seeing it -
// the model marks with a `" TODO(system): ...` comment, and the download
// lists those lines (systemTodos( ), chat.mjs), so "it ran here" is not
// read as "it runs on my system".
//
// Pure: imported by the agent's chunk and the studio's, and by node:test.

// abaplint's own spelling of each release (abaplint.Version).
export const TARGETS = [
  {
    version: "v702",
    label: "ABAP 7.02 - 7.31",
    title: "SAP NetWeaver 7.02 to 7.31 - classic syntax only",
    rules: `The person's system is SAP NetWeaver 7.02 to 7.31, and the syntax check
  runs at v702. Write ABAP 7.02: no inline declarations (DATA( ),
  FIELD-SYMBOL( )), no constructor expressions (VALUE #( ), NEW #( ),
  CONV, COND, SWITCH, REF, CORRESPONDING), no table expressions (itab[ ]),
  no LOOP AT ... GROUP BY, no host variables with @. Declare every variable
  with DATA at the top of the method, fill tables with APPEND, create
  objects with CREATE OBJECT. The guide below is written in 7.50 syntax -
  translate its examples, do not copy them. String templates (|...|) and
  the z2ui5_cl_ui5_view_builder chain work on 7.02.`,
  },
  {
    version: "v740sp08",
    label: "ABAP 7.40",
    title: "SAP NetWeaver 7.40 SP08 - inline declarations and constructor expressions, nothing newer",
    rules: `The person's system is SAP NetWeaver 7.40, and the syntax check runs at
  v740sp08. Inline declarations, VALUE #( ), NEW #( ), COND, SWITCH and
  table expressions are there; nothing that came with 7.50 or later.`,
  },
  {
    version: "v750",
    label: "ABAP 7.50+ / S/4HANA",
    title: "7.50 or newer, S/4HANA on-premise - the playground's default",
    rules: `The person's system is 7.50 or newer (S/4HANA on-premise included), and
  the syntax check runs at v750. Write 7.50 syntax - nothing that needs a
  newer release, since the person may be on 7.50 itself.`,
  },
  {
    version: "Cloud",
    label: "ABAP Cloud",
    title: "ABAP Cloud - SAP BTP ABAP environment, S/4HANA Cloud",
    rules: `The person's system is ABAP Cloud (SAP BTP ABAP environment or S/4HANA
  Cloud), and the syntax check runs at the ABAP for Cloud Development
  language version. Use released APIs only: no CALL FUNCTION of an
  unreleased module, no SELECT from SAP tables (read through released CDS
  views such as I_Product instead), no /ui2/cl_json, no WRITE, no SAP GUI.
  The syntax check sees the language version but not whether an SAP object
  is released - that part is yours: use only objects you know are released
  for ABAP Cloud, and mark the rest as below.`,
  },
];

export const DEFAULT_TARGET = "v750";

export const targetOf = (version) => TARGETS.find((t) => t.version === version);

// A release set in the Config tab that the header does not list (v755,
// v816, open-abap): named as abaplint names it, so the model is still told
// what the check holds it to.
export function targetRules(version) {
  const target = targetOf(version);
  if (target) return target.rules;
  return `The syntax check runs at abaplint's release "${version}" (the person set it in
  the Config tab). Write ABAP that this release accepts and nothing newer.`;
}

export const targetLabel = (version) => targetOf(version)?.label ?? `ABAP ${version}`;

// The marker the model writes above whatever stands in for the reader's
// system. One spelling, matched case-insensitively in the line's comment -
// the part after the `"` that is not inside a literal - so `"TODO(system):`
// and `" todo(system):` both count, and `'" TODO(system): …'` in a string
// does not.
export const TODO_MARK = 'TODO(system):';
const TODO_TEXT = /^\s*todo\(system\):\s*(.*)$/i;
const todoOf = (line) => {
  const { comment } = codeOf(line);
  return comment === undefined ? null : TODO_TEXT.exec(comment);
};
// A line that is nothing but a comment: `*` in the first column, or a `"`
// after nothing but blanks.
const commentOnly = (line) => line.startsWith("*") || /^\s*"/.test(line);

/**
 * Every `" TODO(system): ...` line in the files, in file and line order:
 * { file, line (1-based), text }. A line that only carries the mark, with
 * nothing after it, is listed with an empty text - it is still a place
 * that needs the system.
 */
export function systemTodos(files) {
  const todos = [];
  for (const file of files ?? []) {
    const lines = String(file.source ?? "").split(/\r?\n/);
    lines.forEach((text, i) => {
      const m = todoOf(text);
      if (m) todos.push({ file: file.name, line: i + 1, text: m[1].trim() });
    });
  }
  return todos;
}

// A CALL FUNCTION is the one reference to the reader's system the page
// lets through without a word: abaplint has no function modules to look
// in and does not report one it cannot find, and the transpiled call fails
// only when it runs - on a button nobody pressed here. So every one is
// listed, whether the model marked it or not: marked (a TODO(system) line
// right above it) it is on the download's list already, unmarked it goes
// to the model with the run's report and onto the list as a call.
// The module's name in its quotes, or the variable of a dynamic call - read
// off the line with its literals taken out ('§n' for the n-th; § is no
// character of ABAP's outside a literal), so a literal that says
// CALL FUNCTION is text, not a call.
const CALL_FUNCTION = /\bCALL\s+FUNCTION\s+(?:'§(\d+)'|([\w/~-]+))/i;

/**
 * Every CALL FUNCTION in the files: { file, line (1-based), name, marked }.
 * `name` is the module in its quotes, or the variable of a dynamic call.
 * A line that is a comment, or a call after a `"`, does not count. `marked`
 * is a TODO(system) line above the call with nothing but blank lines and
 * other comments between - a model that writes its note and then a second
 * comment line is not unmarked for it.
 */
export function functionCalls(files) {
  const calls = [];
  for (const file of files ?? []) {
    const lines = String(file.source ?? "").split(/\r?\n/);
    lines.forEach((text, i) => {
      if (text.startsWith("*")) return;
      const { code, literals } = codeOf(text);
      const m = CALL_FUNCTION.exec(code);
      if (!m) return;
      let marked = false;
      for (let above = i - 1; above >= 0 && (lines[above].trim() === "" || commentOnly(lines[above])); above -= 1) {
        if (todoOf(lines[above])) {
          marked = true;
          break;
        }
      }
      calls.push({
        file: file.name,
        line: i + 1,
        name: (m[1] !== undefined ? literals[Number(m[1])] : m[2]).toUpperCase(),
        marked,
      });
    });
  }
  return calls;
}

// The line up to its `"` comment, each '...' or `...` literal replaced by
// '§n' and kept in `literals` - a `"` inside one is text, and a doubled
// quote inside one ('it''s') is one quote of the text. `comment` is what
// follows the `"`, or undefined when the line has none.
function codeOf(line) {
  const literals = [];
  let code = "";
  let quote;
  let text = "";
  let comment;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote && line[i + 1] === quote) {
        text += c;
        i += 1;
      } else if (c === quote) {
        code += `'§${literals.push(text) - 1}'`;
        quote = undefined;
      } else {
        text += c;
      }
    } else if (c === "'" || c === "`") {
      quote = c;
      text = "";
    } else if (c === '"') {
      comment = line.slice(i + 1);
      break;
    } else {
      code += c;
    }
  }
  return { code, literals, comment };
}

/** What the model is told after a run about the calls it did not mark -
 *  empty when there are none. */
export function uncheckedCallsText(files) {
  const unmarked = functionCalls(files).filter((c) => !c.marked);
  if (unmarked.length === 0) return "";
  return [
    `not checked here (${unmarked.length}) - this page has no function modules: abaplint cannot tell whether one exists, and the call fails only when it runs. Mark each with a ${TODO_MARK} line above it, or use local data instead:`,
    ...unmarked.map((c) => `- ${c.file}:${c.line} CALL FUNCTION ${c.name}`),
  ].join("\n");
}
