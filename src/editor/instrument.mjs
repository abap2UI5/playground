// @ts-check
// The debug build of a chunk: the transpiler's JavaScript with a hook in
// front of every ABAP statement it can stop at, and a frame around every
// method - see docs/design/debugger.md.
//
// The transpiler has no option for this, so the hooks are written into its
// output, guided by the two things it hands back beside the code: the
// mappings (which ABAP line and column each piece of a generated line came
// from) and abaplint's statements (which ABAP statement starts where). A
// generated line is the start of a statement when its first mapping sits at
// the line's own indentation and points at the first token of a statement -
// the line `} else {` maps to ELSE and is not one we may put code in front
// of; a LOOP's second line (`fs_x_.assign(…)`) maps into the middle of the
// LOOP and is not its start.
//
// Every hook goes ON a line that is already there, never on a new one: the
// line table that turns a stack frame into an ABAP line (lineTable( ) in
// transpile-core.mjs, locate( ) in src/runtime/index.mjs) stays right without
// knowing the hooks exist.
//
// Pure: no worker, no abaplint, no DOM - tests/node/instrument.test.mjs
// drives it with the transpiler's real output.

/**
 * @typedef {{ row: number, col: number, endRow: number, endCol: number, type: string, cls: string, method: string, kernel?: boolean }} StatementStart
 *   a statement from its first token to its last: rows 1-based, columns
 *   0-based, as the mappings count
 * @typedef {{ cls: string, method: string, file: string, start: number, end: number,
 *   lines: number[], locals: string[] }} MethodInfo
 * @typedef {{ generated: { line: number, column: number },
 *   original: { line: number, column: number }, source: string }} Mapping
 */

// The statements a debugger does not stop at. Either they are not executed
// (declarations), or their line is not one code can go in front of (ELSE,
// WHEN, CATCH - the generated line starts with the `}` of the block before),
// or they have no line of their own in the output at all.
const NOT_STOPPABLE = new Set([
  "Else", "ElseIf", "When", "WhenOthers", "WhenType", "Catch", "Cleanup", "EndTry", "EndCase", "EndAt",
  "Data", "DataBegin", "DataEnd", "FieldSymbol", "Types", "TypeBegin", "TypeEnd", "TypeEnum", "TypeEnumBegin",
  "TypeEnumEnd", "Constant", "ConstantBegin", "ConstantEnd", "Static", "StaticBegin", "StaticEnd",
  "MethodImplementation", "ClassImplementation", "EndClass", "ClassDefinition", "Interface", "EndInterface",
  "Public", "Protected", "Private", "MethodDef", "ClassData", "ClassDataBegin", "ClassDataEnd", "Aliases",
  "Events", "InterfaceDef", "Empty", "Unknown", "NativeSQL", "Include",
]);

// Names the transpiler makes up for its own temporaries - a loop counter, the
// subject of a CASE, sy-index saved across a DO.
const TEMPORARY = /^(unique\d+|indexBackup\d+|\$t_\w*|\$dbg\w*)$/;

const indentOf = (text) => text.length - text.trimStart().length;

/**
 * @param {string} code the chunk as the transpiler wrote it
 * @param {Mapping[]} mappings the chunk's mappings
 * @param {Map<string, StatementStart[]>} statements per source file name
 * @returns {{ js: string, methods: MethodInfo[] } | undefined}
 *   undefined when there is nothing to instrument
 */
export function instrument(code, mappings, statements) {
  const lines = code.split("\n");

  // The first mapping of every generated line, and the statement it starts.
  /** @type {Map<number, Mapping>} */
  const first = new Map();
  for (const m of mappings) {
    const at = first.get(m.generated.line);
    if (at === undefined || m.generated.column < at.generated.column) first.set(m.generated.line, m);
  }
  // Each file's statements in order, to find the one a position is in.
  /** @type {Map<string, StatementStart[]>} */
  const byFile = new Map();
  for (const [file, list] of statements) byFile.set(file, [...list].sort((a, b) => a.row - b.row || a.col - b.col));
  const containing = (file, row, col) => {
    const list = byFile.get(file);
    if (!list) return undefined;
    let lo = 0;
    let hi = list.length - 1;
    let found;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = list[mid];
      if (s.row < row || (s.row === row && s.col <= col)) {
        found = s;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (!found) return undefined;
    if (found.endRow < row || (found.endRow === row && found.endCol < col)) return undefined;
    return found;
  };
  // The statement a 0-based generated line belongs to, read off its first
  // mapping - which for a call is its argument (`take( 1 )` maps at `1`),
  // so the statement is the one the position is IN, not the one starting
  // there. A line that does not begin like a statement of its own - the
  // `} else if (` of an ELSEIF, a continuation - only counts when its first
  // mapping is at the line's own indentation, where the statement is the
  // whole line.
  const startOf = (i) => {
    const m = first.get(i + 1);
    if (m === undefined) return undefined;
    const text = lines[i];
    const indent = indentOf(text);
    if (m.generated.column !== indent && !/^(await\b|[\w$([!])/.test(text.trimStart())) return undefined;
    if (/^(else|catch|finally)\b/.test(text.trimStart())) return undefined;
    // The registry names a file by its URI (file:///zcl_x.clas.abap); the
    // debugger, like the editor, by its plain name.
    const file = String(m.source).replace(/^.*\//, "");
    const s = containing(file, m.original.line, m.original.column);
    return s === undefined ? undefined : { s, file };
  };

  /** @type {MethodInfo[]} */
  const methods = [];
  const out = [...lines];
  for (let i = 0; i < lines.length; i++) {
    const head = startOf(i);
    if (head?.s.type !== "MethodImplementation") continue;
    // A static method is two: an instance method that forwards to it (ABAP
    // lets `obj->static( )` call it) and the static one, all written for the
    // one METHOD statement - its body is the second.
    let open = i;
    if (/^\s*return [\w$]+\.[#\w$]+\(/.test(lines[i + 1] ?? "") && (lines[i + 2] ?? "").trim() === "}" && /^\s*static async /.test(lines[i + 3] ?? "")) {
      open = i + 3;
    }
    if (!lines[open].trimEnd().endsWith("{")) continue;
    const indent = indentOf(lines[open]);
    // The method's closing brace, found through its ENDMETHOD: the brace
    // itself, or the `return …;` right before it. Counting braces would be
    // fooled by the JavaScript a `WRITE '@KERNEL …'` puts in a method.
    let close = -1;
    for (let j = open + 1; j < lines.length; j++) {
      const at = startOf(j);
      if (at?.s.type === "MethodImplementation") break;
      if (at?.s.type !== "EndMethod") continue;
      if (lines[j].trim() === "}" && indentOf(lines[j]) === indent) close = j;
      else if ((lines[j + 1] ?? "").trim() === "}" && indentOf(lines[j + 1]) === indent) close = j + 1;
      break;
    }
    if (close === -1) continue;

    const body = indent + 2;
    const locals = [];
    /** @type {{ index: number, line: number, kind: string }[]} */
    const stops = [];
    const done = new Set();
    let endLine = head.s.row;
    for (let j = open + 1; j <= close; j++) {
      const text = lines[j];
      const local = indentOf(text) === body ? /^let ([A-Za-z_$][\w$]*) = /.exec(text.trimStart()) : null;
      if (local && !TEMPORARY.test(local[1]) && !locals.includes(local[1])) locals.push(local[1]);
      const at = startOf(j);
      if (at === undefined || at.file !== head.file) continue;
      const key = `${at.s.row}:${at.s.col}`;
      if (done.has(key)) continue;
      done.add(key);
      if (at.s.type === "EndMethod") endLine = at.s.row;
      if (at.s.type === "Break" && text.trim() === "debugger;") {
        stops.push({ index: j, line: at.s.row, kind: "break" });
        continue;
      }
      if (NOT_STOPPABLE.has(at.s.type) || at.s.kernel) continue;
      stops.push({ index: j, line: at.s.row, kind: at.s.type === "Raise" ? "raise" : "" });
    }
    const methodIndex = methods.length;
    methods.push({
      cls: head.s.cls,
      method: head.s.method,
      file: head.file,
      start: head.s.row,
      end: endLine,
      lines: [...new Set(stops.map((s) => s.line))].sort((a, b) => a - b),
      locals,
    });
    const accessor = locals.length === 0
      ? "() => undefined"
      : `(n) => { switch (n) { ${locals.map((n) => `case ${JSON.stringify(n)}: return ${n};`).join(" ")} } }`;
    out[open] = `${lines[open]} let $dbg; try { $dbg = abap.dbg.enter(this, $dbgm[${methodIndex}], ${accessor});`;
    for (const stop of stops) {
      const text = out[stop.index];
      const pad = " ".repeat(indentOf(text));
      if (stop.kind === "break") {
        out[stop.index] = `${pad}await $dbg.stop(${stop.line}, 2);`;
      } else {
        // The second argument says what is about to run: 1 a RAISE, for
        // "stop at RAISE EXCEPTION".
        const args = stop.kind === "raise" ? `${stop.line}, 1` : `${stop.line}`;
        out[stop.index] = `${pad}if ($dbg.hit(${args})) await $dbg.stop(${args}); ${text.trimStart()}`;
      }
    }
    // The method's closing brace closes the try first. The ENDMETHOD of a
    // method with nothing to return IS that brace, and its hook is already in
    // front of it - inside the try, so inside the method.
    const closing = out[close];
    out[close] = `${closing.slice(0, closing.lastIndexOf("}"))}} finally { abap.dbg.leave($dbg); } }`;
    i = close;
  }
  if (methods.length === 0) return undefined;
  out[0] = `const $dbgm = abap.dbg.methods(${JSON.stringify(methods.map(({ lines: _l, ...m }) => m))}); ${out[0]}`;
  return { js: out.join("\n"), methods };
}

/**
 * Where each statement of an ABAP file starts, with the class and method it
 * is in - read off abaplint's statements, which are what a debugger steps
 * through.
 * @param {any} abapFile an abaplint ABAPFile
 * @returns {StatementStart[]}
 */
export function statementStarts(abapFile) {
  /** @type {StatementStart[]} */
  const out = [];
  let cls = "";
  let method = "";
  for (const st of abapFile.getStatements()) {
    const type = st.get().constructor.name;
    const tokens = st.getTokens().map((t) => t.getStr());
    if (type === "ClassImplementation") cls = (tokens[1] ?? "").toUpperCase();
    if (type === "MethodImplementation") method = tokens.slice(1, -1).join("").toUpperCase();
    const start = st.getFirstToken().getStart();
    const end = st.getLastToken().getEnd();
    // JavaScript written into the method (`WRITE '@KERNEL …'`): its line is
    // the reader's own JavaScript, nothing a hook may go in front of.
    const kernel = tokens.some((t) => /^'@KERNEL/i.test(t));
    out.push({ row: start.getRow(), col: start.getCol() - 1, endRow: end.getRow(), endCol: end.getCol() - 1, type, cls, method, kernel });
  }
  return out;
}
