# The debugger

> Design notes. Read this before touching `src/editor/instrument.mjs`,
> `src/runtime/debug.mjs`, `src/shell/debug.mjs`, `src/shell/debugger.mjs`,
> or the debug paths of `runtime-client.mjs`, `worker.mjs` and `run.mjs`.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

What the reader gets, on the playground's own page: breakpoints in the
editor's glyph margin (a click, or F9), with a condition if wanted;
`BREAK-POINT`; the program stopped at the line, marked in the editor; the
call stack, each frame's locals and parameters, `me`'s attributes (a static
method: the class's static ones) and the system fields; F5 step into, F6 step
over, F7 return, F8 continue, run to the cursor, Shift+F8 Stop; Pause for a
program that is running (a loop that never ends can be looked at instead of
killed); a value changed by double-click; tables page in blocks of 50 and
open as a grid in a dialog; references followed on demand; watches, and
watchpoints that stop when a value changes; stop at `RAISE EXCEPTION`; the
value under the mouse while stopped; breakpoints kept with the draft. It
works the same in an app's roundtrip, while the classes are defined (a class
constructor) and while the unit tests run. `tests/debug.spec.js` drives all
of it; `tests/node/instrument.test.mjs` holds the hooks.

## How a stop works: everything is async already

The transpiler writes every ABAP method as an `async` JavaScript method and
awaits every call. So a statement can wait on a promise:

```js
if ($dbg.hit(17)) await $dbg.stop(17); lv_sum.set(…);
```

`stop( )` posts `paused` to the page and returns a promise that the page's
Continue resolves. While it waits, the runtime worker is idle and reads its
messages - which is all a debugger needs. No thread is blocked, so no
`SharedArrayBuffer`, no `Atomics.wait`, and no cross-origin-isolation headers
(GitHub Pages cannot send them).

## The debug build (`src/editor/instrument.mjs`)

The transpiler has no option for hooks, so they are written into its output,
in the registry worker, after the transpile and before the chunk leaves for
the runtime (`debugBuild( )` in `transpile-core.mjs`). Two things the
transpiler hands back make that safe:

- **the mappings** - for each piece of a generated line, the ABAP line and
  column it came from;
- **abaplint's statements** - where each statement starts and ends
  (`statementStarts( )`).

A generated line belongs to the statement its *first mapping* is inside
(not starts at: a call `take( 1 )` maps at its argument). The first line of
each statement gets the hook; later lines of the same statement (a LOOP's
`fs_x_.assign(…)`) do not. A line that does not begin like a statement of its
own (`} else if (`) only counts when its first mapping sits at the line's own
indentation.

Not stoppable: ELSE, ELSEIF, WHEN, CATCH, CLEANUP, ENDTRY, ENDCASE (their
line begins with the `}` of the block before), declarations, and any
`WRITE '@KERNEL …'` (that line is the reader's own JavaScript). ENDIF,
ENDLOOP, ENDDO, ENDWHILE and ENDMETHOD are stoppable, as in SAP.

Every method is framed:

```js
async run(INPUT) { let $dbg; try { $dbg = abap.dbg.enter(this, $dbgm[3], (n) => { switch (n) { case "lv_sum": return lv_sum; … } });
  …
  } finally { abap.dbg.leave($dbg); } }
```

- `enter` pushes a frame (the stack is the reader's methods only), `leave`
  in the `finally` pops it, so an exception unwinds the stack as well.
- The scope accessor is a `switch` over the method's locals (every
  `let` at the body's indentation - the transpiler hoists `DATA`, inline
  declarations and field symbols there). No `eval`: nothing the reader types
  is ever evaluated as code; paths are parsed (below).
- A static method is written twice by the transpiler - an instance method
  that forwards (ABAP lets `obj->static( )` call it) and the static one; the
  frame goes on the second.
- The method's end is found through its ENDMETHOD mapping, never by counting
  braces - kernel JavaScript in a method fooled that.
- `$dbgm`, the method table (class, method, file, first and last line,
  locals), is put in front of the chunk's first line.

**Every hook goes on a line that is already there.** The line count does not
change, so the line table that turns a stack frame into an ABAP line
(`lineTable( )`, `locate( )`) is right without knowing the hooks exist, and
so is every dump the editor points at.

**A debug build that does not parse is never run.** `debugBuild( )` parses
each instrumented chunk (`new AsyncFunction`) before it leaves the registry
worker; one that throws falls back to the plain chunk for that object, and
the Debugger tab names the file. `tools/check-instrument.mjs` (in the build
action, after the size check) instruments all of abap2UI5, the samples and
open-abap - 582 objects, 5,764 methods, 56,233 stoppable lines on
2026-11-10 - and fails if any of them would fall back.

The compile answers `stops` beside the chunks: per file, each method's first
and last line and its stoppable lines. The page uses it to move a breakpoint
from a comment or a `DATA` to the next statement of the same method, as
SAP's does, and to draw one outside any method hollow.

## When the debug build is used

**Always, on the playground's own page** (`offersDebugger` in
`src/shell/debug.mjs`: not embedded, not `?view=app`/`full`, not `/ai/` or
`/pilot/`). Not only when a breakpoint is set: then a breakpoint set on a
running app takes effect at once, Pause works on any program, and nothing
has to be compiled again to start debugging - which would mean redefining
the classes under a running app (its static attributes and class
constructor run again). Measured (`node` over
`tests/fixtures/debug/zcl_dbg_bench.clas.abap`, 100,000 iterations):

| | plain | debug build |
| --- | --- | --- |
| a loop of statements (`DO`, `IF`, `APPEND`) | 33 ms | 33-35 ms (0-4 %) |
| a loop that only calls a method | 31 ms | 43 ms (+0.12 µs a call) |

Only the reader's classes are instrumented; a roundtrip's time is the
framework's. Everywhere else the build is the plain one, byte for byte, and
`BREAK-POINT` is the JavaScript `debugger;` it always was: a stop nobody can
see or continue would hang a documentation page, and the AI's Run waits for
the app to start.

## The worker's half (`src/runtime/debug.mjs`)

`abap.dbg` (installed by `index.mjs` before any user class is defined):

- `hit(line, raise)` is what every statement pays: synchronous, a flag for
  "anything armed" (a step, a Pause, a watchpoint), a `Map` lookup for the
  breakpoints of the frame's file, and every 1,024th statement a look at the
  clock. It returns `false` in the common case, so no promise is made.
- `stop(line, kind)` decides why (BREAK-POINT, a Pause, RAISE, a step, a
  breakpoint and its condition, a watchpoint) and pauses, or, when only the
  clock said so, **yields one macrotask** and asks again: a loop only reads
  the page's messages (a Pause, a breakpoint set while it runs) if it gives
  the thread back now and then - 100 ms at most between yields.
- Steps: *into* stops at the next statement anywhere; *over* at the next one
  at this stack depth or less; *return* at a smaller depth; *cursor* at a
  file and line. A step still pending when the worker's operation ends (a
  roundtrip, the tests) is dropped (`operationEnded( )`), or the next click
  would stop on its first statement.

**The commands bypass the worker's queue** (`worker.mjs`): it runs one
operation at a time, and the one moment a Continue matters is while an
operation is stopped - queued behind it, it would wait for ever. They are an
allow list, like the operations: `breakpoints`, `options`, `pause`,
`resume`, `frame`, `expand`, `table`, `watch`, `hover`, `set`,
`watchpoints`. Answers are plain data, bounded (500 characters of a value,
50 rows of a table per block, 200 per block in the table view).

**Paths, not code.** A watch, a condition, the hover and every node of the
variables tree name a value by a path the reader could have typed - `lv_x`,
`<fs>`, `ls_s-comp`, `lt_t[ 3 ]-field`, `me->attr`, `lo->attr`, `lr->*`,
`sy-subrc`, `zcl_x=>attr` - parsed by `parsePath( )` and walked over the
runtime's types. A condition is `path op literal|path` or `path IS [NOT]
INITIAL`, compared with the runtime's own `abap.compare`. A new value is
moved from a string, so ABAP's conversion rules apply and a bad one is
refused with the runtime's message.

## The page's half

`src/shell/debug.mjs` is in the shell entry (on every page) and holds next to
nothing: whether the page offers the debugger, the compile option, the
last compile's `stops`, and the import of `src/shell/debugger.mjs`, the chunk
with everything else - fetched once the runtime is up, handed what it needs
of the page (the chunk rule in [load-time.md](load-time.md)). Run waits for
it before it starts the app (`debuggerReady( )`), so a breakpoint kept from
the last visit is in the worker before the app's first roundtrip.

`runtime-client.mjs`:

- routes `type: "debug"` messages from the worker (both the first worker's
  listener and a restarted one's);
- **holds the watchdog while stopped** - a reader looking at a breakpoint
  for a minute is not a loop that never ends - and arms it again, with the
  whole limit, when the program goes on;
- keeps the last `breakpoints` and `options` and replays them into a fresh
  worker, so a Stop or a runaway's restart does not lose them;
- **Stop** terminates the worker and starts a fresh one, as the runaway path
  does; every waiting call rejects with `DEBUG_STOPPED`, which `run.mjs` and
  `agent-hooks.mjs` take as "nothing to report". The program is not unwound
  by a thrown error: a `CATCH` would catch it, a `CLEANUP` would run the
  reader's code, and the framework would write a dump. The app frame is left
  as it was; Run starts it again.

While stopped the editor is read-only (`setDebugLock( )`) - the marks must
not move under the text - without the grey of the View tab's lock, and a
Run first ends the stop; Auto never does. F5-F8 and Shift+F8 are taken in the
capture phase while stopped (F5 would reload the page, F8 is Monaco's "next
problem"); F9 is a Monaco command and works whenever the editor has focus.

On a phone the stop brings the ABAP pane forward (the app has the screen
there, and a Run whose app start stopped no longer switches to it); a tap
in the glyph margin sets a breakpoint, and the step bar wraps above the
stack.

Breakpoints are model decorations in the glyph margin, so they move with
the text typed above them; the list follows the decorations. They are kept
under `abap2ui5-playground:breakpoints` by file name, validated like every
stored setting, and only on the page that offers the debugger.

## Deliberate limits

- **Only the reader's classes.** The framework and open-abap are the
  build's bundle, not instrumented: *into* on a framework call is *over*, and
  the stack shows the reader's frames with abap2UI5 named under them.
  Instrumenting the framework (a second bundle, loaded on demand) was
  planned as a stretch; `check-instrument.mjs` shows the hooks would hold
  for all of it. Not done: it is a second 5.5 MB runtime to build, cache and
  budget for, for stepping through code the reader did not write.
- **Statements inside a CATCH or CLEANUP block cannot be stopped at.** The
  transpiler writes those blocks without mappings, so there is no ABAP line
  to put a hook on. The CATCH's handler runs; a breakpoint there is drawn
  hollow. The fix belongs in the transpiler (mappings for the catch body).
- **A runtime error is not stopped at** (a division by zero raised by the
  runtime, not by a RAISE): it is pointed at as a dump, as before.
- **Watches and conditions are paths and comparisons**, not ABAP
  expressions: a method call in a watch would run the reader's code from the
  debugger.
- **No debugger in an embed, on `?view=app`/`full`, or on the AI pages**
  (above). An opt-in for an embed would be a contract with abap2UI5/docs.
- **A moved breakpoint is checked at the next Run.** Edits move the marks,
  but what runs is the last Run's build; the line sent is the editor's.
