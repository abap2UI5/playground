# Roadmap: an ABAP debugger for the playground

> A build plan, written to be handed to an AI agent one milestone at a time.
> It starts with the smallest thing that is honestly a debugger (M1: the
> statement `BREAK-POINT` halts the app) and ends with "as in the SAP
> debugger" (M6), plus two optional stretches (M7, M8).
> Status: plan only. Nothing here is implemented. When a milestone lands,
> move what became true into `docs/design/debugger.md` and delete it here.

## 1. How to use this document

- **One milestone = one pull request.** Do not start a milestone before the
  one before it is merged and green. Each milestone is shippable on its own.
- Before any change, read `AGENTS.md`, then `docs/design/runtime.md`,
  `docs/design/panel.md`, `docs/design/load-time.md`,
  `docs/design/testing.md` and `docs/design/phone.md`. Their rules win over
  this plan; if one contradicts a step here, stop and say so in the PR.
- Section 2 is what was measured, section 3 is the design every milestone
  shares. Do not redesign section 3 inside a milestone; if it turns out to
  be wrong, fix section 3 first, in its own commit.
- Every milestone ends with the same gate (section 5).

## 2. What is known (measured 2026-11-10, transpiler 2.14.15)

These were checked against this repository and with a prototype (appendix A).

1. **Every transpiled method is `async`**, and every call is awaited. A
   statement can therefore wait on a promise, and the worker is idle while it
   waits, so it can receive messages. No `SharedArrayBuffer`, no
   `Atomics.wait`, no special headers (GitHub Pages could not send them).
2. **The transpiler has no debug option** (`ITranspilerOptions` has none).
   `BREAK-POINT` is transpiled to the JavaScript statement `debugger;`.
3. **Locals are hoisted.** Parameters, `DATA`, inline `DATA(...)` and field
   symbols are all `let name = …` at the top of the method body, so a closure
   created anywhere in the method sees all of them. A field symbol `<lv>` is
   `fs_lv_`. Loop temporaries are `const uniqueN` / `indexBackupN`.
4. **Private methods are JavaScript private (`#helper`)**. They cannot be
   wrapped from outside the class, so call tracking has to be in the text.
5. **The chunk's mappings identify statement starts.** For a generated line
   whose first mapping sits at the line's indentation column and whose
   `original` (line, column) is the first token of an abaplint statement,
   that line is where the statement begins. Seen on the sample: `ELSE` maps to
   `} else {` (inserting code before it is a syntax error), `CATCH` has no
   line-start mapping, `ENDMETHOD` maps to `return rv;`, `LOOP` maps to two
   lines of which only the first matches the statement's column.
6. **The prototype works.** Hooks inserted by rule 5, a breakpoint table, a
   pause that is a promise resolved from a macrotask, locals read through
   `($) => eval($)`, a local changed from outside (`lv_sum` set to 100, the
   result changed accordingly).
7. **Cost of the hooks with no breakpoint hit:** about 2x on a method that is
   nothing but arithmetic and loops (36 ms against 18 ms for 5000 calls, with
   `await hook()` on every statement). User code only; the framework is not
   instrumented. The guarded form in 3.2 avoids the `await` and should be
   cheaper; measure it in M2.
8. **A loop that only awaits resolved promises never yields to messages**
   (`runtime-client.mjs`, "A WORKER THAT NEVER ANSWERS AGAIN"). A running
   program can therefore only be paused, or learn of a new breakpoint, if the
   hook yields to a macrotask now and then.
9. **The worker handles one operation at a time** (`worker.mjs`, the `queue`).
   A debug command sent while a roundtrip is paused would wait behind that
   roundtrip for ever. Debug messages must bypass the queue.
10. **The page kills the worker after 30 s** in `roundtrip`, `defineClasses`
    and `runUnitTests` (`WATCHED`, `RUNAWAY` in `runtime-client.mjs`). A
    paused program must not count.
11. `new AsyncFunction` is how chunks are defined today, in the runtime
    worker, so `eval` is available there. The document's CSP (`script-src
    'self'`) does not govern a dedicated worker's own evaluation here.

Not verified, to be checked in M0: how `CASE`/`WHEN`, `ELSEIF`, `CLEANUP`,
`ENDMETHOD` of a method without `RETURNING`, chained statements (`DATA: a,
b.`), macros, local classes and test includes come out; what `lockEditor()`
does exactly; whether the frame or `agent-hooks.mjs` gives up on a roundtrip
that takes minutes; Firefox and WebKit behaviour of `eval` in the closure.

## 3. The design all milestones share

### 3.1 When code is instrumented

- A **debug build** of the user's chunks is made by `compile(files, { debug:
  true })` in `src/editor/transpile-core.mjs`. Without the flag the output is
  byte-for-byte what it is today. The framework bundle is never instrumented
  before M7.
- A Run is a debug Run when the page offers the debugger (below) **and**
  there is at least one breakpoint or the source contains `BREAK-POINT`.
  From M5 on, arming does not need a new Run.
- **The debugger is offered only on the playground's own desk page.** Not
  when `embedded`, `appOnly`, `aiPage` or `pilotPage` (`page.mjs`). There
  `BREAK-POINT` stays `debugger;` as today. Reason: a pause nobody can
  resume hangs an embed and hangs the AI's `runForAgent()`.
- If an instrumented chunk does not parse (`new AsyncFunction(js)` throws a
  `SyntaxError` in the registry worker), fall back to the plain chunk for
  that object and report one sentence in the Log: "Breakpoints in
  zcl_x.clas.abap are not available: …". Never fail a Run because of the
  debugger.

### 3.2 The hooks

Inserted **on the same generated line, in front of what is there**, never as
a new line: `lineTable()` and `locate()` then stay correct without change.

```js
// prologue of the chunk (one per source file the chunk has mappings for)
const __f0 = "zcl_demo.clas.abap";

// M1-M3: in front of each stoppable statement
if (abap.dbg.hit(__f0, 17)) await abap.dbg.stop(__f0, 17, this, ($) => eval($));

// M4 and later: at METHOD (appended after the `{` of the mapped line) ...
const __d = abap.dbg.enter("ZCL_DEMO", "RUN", __f0, this, ($) => eval($)); try {
// ... in front of each stoppable statement ...
if (abap.dbg.hit(__f0, 17)) await abap.dbg.stop(__d, 17);
// ... and in front of the method's closing brace
} finally { abap.dbg.leave(__d); }
```

- `hit()` is synchronous and returns `false` in the common case, so no
  promise and no microtask is spent on a statement nobody stops at. It
  returns `true` when: a breakpoint is on (file, line); a step is pending
  and this statement satisfies it; a pause was requested; a watchpoint
  exists; or the yield described in 3.4 is due.
- **Stoppable** = a statement inside `METHOD … ENDMETHOD` that passes rule 5
  of section 2 and is not one of: `ELSE`, `ELSEIF`, `WHEN`, `CATCH`,
  `CLEANUP`, `ENDTRY`, `ENDCASE`, declarations (`DATA`, `TYPES`,
  `CONSTANTS`, `FIELD-SYMBOLS`, `STATICS`), `METHOD` itself, comments, empty
  statements. `ENDMETHOD`, `ENDIF`, `ENDLOOP`, `ENDDO` are stoppable, as in
  SAP. Start from the list in appendix A and correct it in M0.
- The compile result gains `stops`: per file, the sorted list of stoppable
  ABAP lines. The page uses it to snap and verify breakpoints.
- `BREAK-POINT` becomes `await abap.dbg.stop(…, { forced: true })` in a
  debug build (replace the generated `debugger;` on that line).
- The scope accessor is `eval`. It is only ever called with a name taken
  from the worker's own list of that method's locals, or matched against
  `/^[A-Za-z_$][\w$]*$/`. Never pass text typed by the reader to it.

### 3.3 The worker side: `src/runtime/debug.mjs` (new)

Installs `globalThis.abap.dbg` once, at module load. State: breakpoints
(`Map<file, Map<line, {condition?}>>`), `mode` (`run` | `into` | `over` |
`return` | `cursor`), the frame stack (M4), the current pause (`{resolve,
file, line, frame}`), `lastYield`.

It owns everything that needs the ABAP object model: reading locals, `me`,
`sy`; describing values (reuse `describe()` from `app-state.mjs` - export it,
do not copy it); changing a value (M6).

### 3.4 Pausing, resuming, stopping

- **Pause** = `stop()` posts `{ type: "debug", event: "paused", … }` and
  returns a promise kept in the debug state. **Resume** = a debug command
  resolves it.
- **The debug channel bypasses the queue.** In `worker.mjs`, a message with
  `data.debug` is handed to `debug.mjs` at once, not appended to `queue`.
  It is an allow list of commands like `OPS`, not `debug[op]`.
- **The watchdog pauses with the program.** In `runtime-client.mjs`, on
  `paused` clear the pending call's watchdog; on `resumed` arm it again with
  the full limit. Both message listeners (the first worker's and
  `restart()`'s) must route `type: "debug"`; fold them into one function
  first, as a separate commit.
- **Stop** = terminate the worker and start a fresh one (the existing
  `restart()` path), reject the pending call with a new error name
  `DebugStopped` that `run.mjs` and `agent-hooks.mjs` treat as "nothing to
  report". Do not try to unwind the ABAP with a thrown error: `CATCH` blocks
  rethrow it, `CLEANUP` and `finally` run user code, and the framework's
  handler would write a dump.
- **Yield** (from M5): in a debug Run, `hit()` returns `true` when more than
  100 ms passed since the last yield; `stop()` then awaits one macrotask
  (`MessageChannel`, not `setTimeout`, which is clamped to 4 ms) and returns
  unless a pause was requested meanwhile. This is what makes the Pause
  button, breakpoints set while running and "an endless loop can be
  inspected instead of killed" possible.
- A new Run while paused = Stop, then Run. Autorun never fires while paused.
- While paused the editor is read-only (lines must not move under the
  marker); say so in the status line.

### 3.5 Protocol

Page → worker, all with `debug: true`, none queued:

| `cmd` | Fields | From |
| --- | --- | --- |
| `breakpoints` | `list: [{file, line, condition?}]` (the whole set, replaces) | M2 |
| `resume` | `mode: "run" \| "into" \| "over" \| "return" \| "cursor"`, `file?`, `line?` | M1 (`run`), M4 |
| `pause` | | M5 |
| `variables` | `frame`, `path` → answered by `reply` | M3, lazy from M6 |
| `set` | `frame`, `path`, `value` | M6 |
| `watch` | `list: [{expr}]` | M6 |
| `options` | `breakOnRaise`, `system` | M6, M7 |

Worker → page, `type: "debug"`:

| `event` | Fields |
| --- | --- |
| `paused` | `file, line, reason` (`breakpoint` \| `statement` \| `step` \| `pause` \| `watch` \| `raise`), `stack: [{class, method, file, line}]` (M4), `me`, `locals`, `sy` (M3) |
| `resumed` | |
| `reply` | `id, ok, value \| error` |

Plain data only, bounded like the State tab's snapshot (`MAX_*` in
`app-state.mjs`).

### 3.6 The page side

| Module (new unless noted) | Purpose |
| --- | --- |
| `src/shell/debug.mjs` | The debugger's state on the page: breakpoints per file, paused or not, the last `paused` event; `armed()`; talks to `state.runtime.debug` |
| `src/shell/insight-debug.mjs` | The panel's **Debugger** tab: step bar, call stack, variables. A chunk loaded on first use; it never imports a shell module (load-time rule) |
| `src/shell/runtime-client.mjs` (changed) | `debug(cmd)`, `onDebug(fn)`, the watchdog rule of 3.4 |
| `src/editor/monaco-editor.mjs`, `editor.mjs`, `file-store.mjs` (changed) | `setBreakpoints()`, `onBreakpointToggle()`, `markPaused(file, line)`; `file-store.mjs` gets no-ops |
| `src/shell/run.mjs` (changed) | Passes `debug: armed()` to `compile()`, handles `DebugStopped` |
| `src/shell/storage.mjs` (changed) | Breakpoints per file set, from M6 |

Keys follow SAP: **F5** step into, **F6** step over, **F7** return, **F8**
continue; **Shift+F8** stop. Bound only while paused and only on the page's
own document; `preventDefault()` so F5 does not reload. Outside a pause F5
stays the browser's.

### 3.7 Deliberate limits (write them into `AGENTS.md` when they ship)

- No stepping into the framework or open-abap before M7: "step into" on a
  framework call is "step over".
- No arbitrary ABAP expressions in watches: variable paths only.
- A runtime error (division by zero, a null reference) cannot be paused at
  after the fact; it is shown where it was raised, as today.
- No debugger on embeds, app-only pages, `/ai/` and `/pilot/` (3.1).

## 4. Milestones

Effort is for an AI agent with a human reviewing, in working days.

### M0 - Spike and proof (1 day)

Goal: turn appendix A into a tested function and settle the open questions
of section 2. No user-visible change.

1. Add `src/editor/instrument.mjs`: `instrument(chunk, statements, options)
   → { js, stops }`, a pure function over the generated code, the chunk's
   mappings and abaplint's statement list. No worker, no DOM.
2. Add `tests/node/instrument.test.mjs`: fixtures under
   `tests/fixtures/debug/` covering `IF/ELSEIF/ELSE`, `CASE/WHEN`,
   `TRY/CATCH/CLEANUP`, `LOOP`, `DO`, `WHILE`, nested blocks, a method with
   and without `RETURNING`, a static method, a private method, chained
   statements, two statements on one line, inline declarations, a local
   class, a test include, `BREAK-POINT`, a `class_constructor`. For each:
   the instrumented code parses (`new AsyncFunction`), has exactly one hook
   per expected line (expected lines written in the fixture), and the
   generated line count equals the plain chunk's.
3. Add `tools/check-instrument.mjs` and run it in `npm run check` after the
   build: instrument every carried sample (`src/editor/sample-list.mjs`,
   from `deps/`) and assert each parses. Report the count and time.
4. Write down in `docs/design/debugger.md` what was found for each open
   question, including Firefox/WebKit.

Done when: the node test and the sample check are green, and the stoppable
list in 3.2 is corrected to what the fixtures showed.

### M1 - `BREAK-POINT` halts, Continue resumes (2-3 days)

The smallest real debugger: no gutter, no stepping, no new tab.

1. `compile(files, { debug })`: in a debug build only `BREAK-POINT` lines
   are rewritten (3.2). Debug is on when the page offers the debugger and
   any file contains a `BREAK-POINT` statement (ask abaplint, not a regex).
2. `src/runtime/debug.mjs` with `stop()` and `resume`; the debug channel in
   `worker.mjs`; the watchdog rule and `debug()`/`onDebug()` in
   `runtime-client.mjs`; Stop as terminate-and-restart.
3. On `paused`: open the file, mark the line (a new decoration class, not
   the dump's), set the editor read-only, status line "paused at
   zcl_x.clas.abap line 17 - Continue (F8) or Stop". A **Continue** and a
   **Stop** button appear beside Run while paused. The State tab shows the
   attributes of `me` at the pause (send `me` with `paused`, reuse
   `insight-state.mjs`'s rendering).
4. Run while paused stops first. Autorun is held while paused.
5. `tests/debug.spec.js`: a class with `BREAK-POINT` in an event handler -
   the app starts, a click pauses, the line is marked, the frame shows
   nothing new, Continue finishes the roundtrip and the app shows the
   result; a pause survives 35 s with `__abap2ui5RunLimit` set to 2 s; Stop
   then Run works; on `?view=app` and with `?embed=` the same class does not
   pause.
6. Docs: `docs/design/debugger.md` (new), the `AGENTS.md` tables and rules,
   one README paragraph.

### M2 - Breakpoints in the editor (3-4 days)

1. `instrument()` hooks every stoppable statement (the M1-M3 form of 3.2);
   `compile()` returns `stops`.
2. Monaco: `glyphMargin: true`; a click in the glyph margin toggles a
   breakpoint; breakpoints are model decorations so they move with edits;
   F9 toggles on the caret's line. After each compile, snap a breakpoint to
   the next stoppable line of the same method, or show it hollow
   ("not reachable") if there is none.
3. `breakpoints` command; sent after `defineClasses` of a debug Run and on
   every change.
4. Debug Run when a breakpoint exists (3.1). Setting the first breakpoint
   on a running, non-debug app says "takes effect at the next Run" in the
   status line (M5 removes this).
5. Measure the overhead of the guarded hook on three carried samples and
   write the numbers into `debugger.md`.
6. Tests: toggle by click and F9; a breakpoint in `main` pauses on the
   first roundtrip; one in a second file of the set pauses and opens that
   file; removing it lets the next roundtrip through; a breakpoint on an
   `ELSE` line snaps; editing above a breakpoint moves it.

### M3 - Variables (3-4 days)

1. `instrument()` returns, per method, the JavaScript names of its locals
   (the `let NAME =` lines at method-body indentation) with their ABAP
   display names (`fs_lv_` → `<lv>`, importing/returning parameters marked).
2. `paused` carries `locals`, `me`, `sy` (subrc, tabix, index, datum, uzeit,
   …), each described by `describe()` with the State tab's bounds.
3. `insight-debug.mjs`: the **Debugger** tab with three folding groups -
   Locals, `me`, System fields - in the State tab's tree rendering; values
   that changed since the previous pause are marked, as State does. The tab
   comes forward on a pause and has an empty state otherwise.
4. Tests: an integer, a string, a structure, a table (row count and the
   first rows), a reference (named, not followed), a field symbol (assigned
   and unassigned), an inline declaration before and after its statement.

### M4 - Stepping and the call stack (4-5 days)

1. The `enter`/`leave` form of 3.2. `leave` sits in a `finally`, so the
   stack is right after an exception. `class_constructor` and
   `constructor_` are methods like any other.
2. Stack in `paused`; the tab lists it; choosing a frame shows that frame's
   locals and marks its line (a second, paler marker).
3. Step modes in `hit()`: `into` = the next stoppable statement anywhere;
   `over` = the next at stack depth ≤ the current; `return` = the next at
   depth < the current; `cursor` = a one-shot breakpoint. A step that leaves
   the last user frame ends in the framework: the program simply runs on.
4. The step bar and the keys of 3.6.
5. Tests: step over a method call stays; step into enters and the stack
   grows; return comes back to the line after the call; stepping past
   `ENDMETHOD` of `main` finishes the roundtrip; a recursive method shows
   each level; an exception caught two frames up leaves the stack correct.

### M5 - Everything that runs, and running programs (3-4 days)

1. Unit tests: a breakpoint in a test include or in the class under test
   pauses during `runUnitTests`. The Tests tab shows "paused" for that row.
2. The yield of 3.4. A **Pause** button while a debug Run's roundtrip is in
   flight; breakpoints changed while running take effect within 100 ms; an
   endless loop can be paused and inspected, and Stop ends it.
3. Arming without a Run: setting the first breakpoint on a running app
   recompiles the same files as a debug build and calls `defineClasses`
   under `withRunLock`, with no database reset and no frame restart. Only
   when the text is unchanged since the last Run; otherwise the M2 sentence
   stays. Check with `tests/state.spec.js`-style assertions that the app's
   state survives.
4. Tests for each, plus: a breakpoint hit inside a `class_constructor`
   during `defineClasses`.

### M6 - As in the SAP debugger (5-8 days, split into two PRs if large)

1. **Change a value**: double-click an elementary value, type, Enter;
   validated by the type's own `set()`, an error shown inline.
2. **Lazy variables**: tables page in blocks of 50, structures and
   references expand on demand (`variables` with a `path`); a reference can
   be followed, with cycle-safe paths.
3. **Table view**: a table opens as a grid in a dialog, columns from the
   row type.
4. **Watches**: variable paths (`ls_x-comp`, `lt_tab[ 3 ]-field`,
   `me->attr`, `<fs>`), parsed on the page, resolved in the worker.
5. **Watchpoints**: stop when a watched path's value changes (compared
   after each statement of a debug Run while one exists).
6. **Conditional breakpoints**: `path op literal` only, with the same path
   parser.
7. **Break at `RAISE EXCEPTION`** in user code, as an option.
8. **Breakpoints persist** with the draft (`storage.mjs`, validated like
   every stored setting, never on an embed). A breakpoints list in the tab:
   file, line, condition, enable/disable, delete all.
9. Hover over a variable in the editor while paused shows its value.
10. Tests for each numbered item.

At this point the debugger has: breakpoints (line, statement, conditional),
watchpoints, F5-F8 stepping, run to cursor, the call stack with frame
switching, locals/`me`/system fields, value changes, a table view and
exception breakpoints - the working set of the SAP debugger for user code.

### M7 - Stepping into the framework (stretch, 5+ days, decide after M6)

"System debugging". A second, instrumented framework bundle
(`dist/runtime/framework-debug.mjs`, abap2UI5 classes only, not open-abap),
built by `tools/build-framework.mjs`, never precached, loaded only when the
option is switched on (the worker is restarted on it). Needs: its own size
budget entry, the corpus file of the paused line opened read-only, and
either the upstream option of 4.1 or `instrument()` applied to the CLI's
output. Measure the bundle and boot first; refuse it in `debugger.md` with
the numbers if it costs more than it shows.

### M8 - Other surfaces (stretch)

Phone layout (step bar as a row above the app, breakpoints by long-press),
an opt-in for embeds (`?debug=1`, a contract with abap2UI5/docs - ships
before any docs change), and a `debug` tool for the AI App Builder. Each is
its own PR and its own decision.

### 4.1 In parallel: the upstream option

Open an issue, then a PR, at abaplint/transpiler for an option that emits
the hooks of 3.2 itself (a statement hook and a method enter/leave hook).
When a release carries it, replace `instrument()`'s text insertion with the
option and keep `tests/node/instrument.test.mjs` unchanged as the proof.
Until then the text insertion is the implementation, protected by the M0
gate and the fallback of 3.1.

## 5. The gate for every milestone

```sh
npm run lint && npm run typecheck && npm run test:unit
npm run build && npm run check:size
npm test -- debug run state insight editor worker unit
```

and the full `npm run check` once before the PR is opened. In addition:

- A plain Run's chunks are byte-identical to before (a node test compares
  `compile(files)` output with and without the debugger code present).
- `tests/isolation.spec.js` and `tests/bfcache.spec.js` stay green: no
  window reach-through, no `beforeunload`.
- New `localStorage` access goes through `storage.mjs`; the new tab is a
  chunk; nothing is added to the shell entry beyond a few lines.
- `AGENTS.md` (module tables, rules, deliberate limits), `README.md` and
  `docs/design/debugger.md` say what is now true.

## Appendix A - the prototype's instrumentation (Node, verified)

```js
// statements: abaplint's, as "row:col0" -> statement class name
const starts = new Map();
for (const st of file.getStatements()) {
  const p = st.getFirstToken().getStart();
  starts.set(`${p.getRow()}:${p.getCol() - 1}`, st.get().constructor.name);
}
// the first mapping of each generated line
const first = new Map();
for (const m of chunk.mappings) {
  const p = first.get(m.generated.line);
  if (!p || m.generated.column < p.generated.column) first.set(m.generated.line, m);
}
const SKIP = new Set(["Else", "ElseIf", "When", "WhenOthers", "WhenType", "Catch",
  "Cleanup", "EndTry", "EndCase", "Data", "FieldSymbol", "Types", "Constant",
  "MethodImplementation", "ClassImplementation", "EndClass", "Empty", "Unknown"]);
const done = new Set();
const js = chunk.getCode().split("\n").map((text, i) => {
  const m = first.get(i + 1);
  if (!m) return text;
  const indent = text.length - text.trimStart().length;
  if (m.generated.column !== indent) return text;
  const key = `${m.original.line}:${m.original.column}`;
  const type = starts.get(key);
  if (!type || SKIP.has(type) || done.has(key)) return text;
  done.add(key);
  return `${" ".repeat(indent)}await abap.dbg.at(${m.original.line}, this, ($) => eval($)); ${text.trimStart()}`;
}).join("\n");
```

The prototype that was actually run put the hook on a line of its own; the
same-line form above is what 3.2 asks for and is the first thing M0 proves.

Run against a class with `DO`, `LOOP … ASSIGNING`, a private method call,
an inline declaration and `IF/ELSE`, it produced hooks on lines `Do, Append,
EndDo, Loop, Move, EndLoop, Move, If, Move, Move, EndIf, Move, EndMethod`,
paused four times on two breakpoints, and read `lv_sum`, the table and the
field symbol at each. Still to restrict: statements outside a method body
(the prototype's class had none that matched).
