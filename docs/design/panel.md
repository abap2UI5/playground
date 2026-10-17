# The bottom panel: View, Tests, Roundtrips, Console, State

> Design notes, moved out of `AGENTS.md`. Read this before touching `src/shell/insight*.mjs`, the View tab's edit mode (`chain-*.mjs`, `view-edit.mjs`), unit tests or dump locating.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## How the panel is put together

`src/shell/insight.mjs` is the panel itself - the strip, folding, the drag of
its height, redrawing - and each tab is a module of its own that draws its
view as a node and knows nothing of the strip: `insight-problems.mjs`,
`insight-outline.mjs`, `insight-view.mjs`, `insight-tests.mjs`,
`insight-roundtrips.mjs`, `insight-state.mjs`, `insight-console.mjs`,
`insight-log.mjs`, and the two checkers' settings in `insight-config.mjs`.
`insight-common.mjs` is what a tab may ask of the panel (`connectPanel( )`,
`redrawIf( )`, `empty( )`, `blockHead( )`).

**An empty tab shrinks the panel to one line.** The `is-empty` class lets go
of the stored height without changing it, so the panel comes back to the
height the reader gave it once there is something to show; growing back waits
1.2 s (`SETTLE_MS`) so typing that briefly clears a list does not make the
panel jump. A drag keeps its height until another tab is opened. The two
Config tabs scroll, with Apply and Reset in a sticky row at their foot.

## The View tab and its edit mode

The **View tab** (`viewTab()` in `src/shell/insight-view.mjs`) shows the XML
the linter reconstructs from the open file's builder chain — `lintViewsFor()`
in `editor.mjs`, read off the kept analysis: the same reconstruction the
findings come from, carried back from the worker in the same message, put one
element per line by `xml-pretty.mjs` and coloured by `highlight.mjs`. It
costs nothing beside the analysis (it used to be a second run of the linter
while the tab was open), and the tab is drawn again whenever a fresh analysis
lands; it says so when the linter has not looked at the file yet and when the
file builds no view.

**Edit** turns that tab around: change the XML and the chain is written again
to build it. Four files, and the middle one is the whole design.
`chain-read.mjs` reads the chain back out of the ABAP by *executing* the four
builder methods against a tree — `a( )` lands on the last child if there is one
and on the node itself if there is not, exactly as the class does, which is why
the split shape (a statement per subtree, held in variables) reads correctly
without the reader knowing about shapes. Every attribute keeps the ABAP that
produced it, verbatim. `view-edit.mjs` matches the edited document against the
one that was shown — by name, longest common subsequence at each level, so an
inserted control does not shift everything after it onto the wrong original —
and an attribute whose value still reads as it was shown gets its original ABAP
back. **That is the point of the whole thing**: the reconstruction renders
`client->_bind( t_flight )` as `{/T_FLIGHT}` and `client->_event( … )` as
`.eB()`, so a chain generated from the rendering alone would compile, run, and
quietly be a different app with every binding frozen. `chain-write.mjs` writes
the single-chain shape in the house layout, which the linter's
`chain-house-layout` rule checks (see the `view-chain-layout` skill in the
framework repository) — `tests/view-edit.spec.js` holds both the layout and the
surviving binds.

`chain-patch.mjs` is the fourth, and it runs **before** the writer: it is the
answer to a rewrite that was correct and unreadable. A one-word change used to
come back as a diff over the whole method — the sample's split shape (a
statement per subtree, held in variables, which is what most of
abap2UI5/samples is written in) collapsed into one chain, the namespace
declarations moved to the front, blank lines appeared, every continuation line
re-anchored. Both chains were in the house layout; they were simply not the
same chain, because the whole thing had been generated again. So the
reader-facing rule is now the one the values already had, applied to the ABAP
as a whole: **what nobody edited is not rewritten.** A changed value is written
over exactly itself (`chain-read.mjs` keeps a source range per attribute
alongside its ABAP); a control whose attribute set changed has its attribute
block written again in its own column — the block rather than the one line,
because the `v =` column is aligned across it — in the chain's own attribute
order, new ones last, with every untouched value copied verbatim (a wrapped
`&&` value keeps its continuation lines); a `tag( )` leaf that was taken out
has its own lines cut; anything else that changes the shape of the view, a
control added or renamed, falls back to `chain-write.mjs` and the full
single-chain rewrite, which is what it always did. The patch runs only when the
two trees are provably the same tree, node for node and attribute for
attribute (bar one leaf taken out per control), so leaving the surrounding ABAP
alone is the correct rewrite rather than a cheaper one - and its result is read
back with `readViewChain` to check it builds the tree asked for, or the writer
takes over. `tests/view-edit.spec.js` holds the cases: one value changed and
the file otherwise byte for byte what it was, Save with nothing changed
changing nothing, an attribute added and taken out again arriving back at the
file that was there (in the split shape too, with the root's order and a
wrapped value kept), a leaf removed in place beside a comment, and the two
refusals below.

What it will not do it says instead of guessing: a view built with a LOOP or an
IF, a control name held in a variable, two views in one method, the same
attribute set twice on one control, text between two tags (the builder sets
attributes; it has no call for a text node), a value with a line break in it.
The button is disabled with that sentence as its title. Two more are refused
at Save, because only the edit decides them: a change that needs the full
rewrite while a chain variable is used later in the method (the rewrite is one
statement and declares one variable), and a change that cannot tell which of
two controls that read the same in the view but carry different ABAP it keeps
(every event reads `.eB()`, so two "Go" buttons are indistinguishable there),
and a full rewrite over a chain with comments in it, which it would drop. While the editor is open the ABAP editor is
read-only (`setEditorReadOnly()`) — the ABAP is derived from the XML for as
long as it is, and two editable copies of one view would mean deciding which is
the truth on every keystroke. It also *looks* read-only: the same call puts
`is-readonly` on the editor pane and `shell.css` greys the source back and
takes the caret away, because Monaco's read-only state is otherwise
indistinguishable from its editable one — same colours, and a caret that still
lands where it is clicked — and nobody should have to type into it to find out
that it will not take it.

## Unit tests and dumps

**Unit tests run before the app** (`tests/unit.spec.js`, the `unit-tests`
sample). A `<class>.clas.testclasses.abap` file is a class's test include
(`files.mjs` — it has no sidecar of its own, needs its class open, and is
never the first file); the transpiler emits it as a chunk of its own that
registers each local class as `CLAS-<class>-<local>`, and `compile()` lists
the test classes and methods FOR TESTING off abaplint's file info, the same
way the transpiler's own runner script does. `runUnitTests()` in
`src/runtime/index.mjs` feeds them to open-abap's `kernel_unit_runner`
(class_setup, setup, method, teardown; expected, actual, message and the
JavaScript frame of the assertion, which `locate()` turns into the ABAP
line), `run()` in `main.mjs` runs them between compile and app start, and
the **Tests** tab (`testsTab()` in `insight-tests.mjs`) lists them — a failure
brings the tab forward and is said in the status line, and the app starts
regardless, because it is the fastest way to see what the test is about.
The file strip follows the editor's model change (`onFileShown()`), so a
row into another file lights the right tab; it used to follow only its own
clicks.

**A dump is pointed at** (`tests/run.spec.js`, "a dump is pointed at"). The
transpiler's chunk carries a source map; `compile()` in `transpile-core.mjs`
keeps it as a line table per chunk and names the chunk, `defineClasses()` in
`src/runtime/index.mjs` evaluates each chunk under that name (a `sourceURL`),
and `locate()` there turns a JavaScript stack into an ABAP file and line.
Two stacks reach it: an ABAP exception's — `cx_root extends Error` in the
transpiled code, so it carries the stack from where it was raised, and the
framework's `_error_response` is wrapped to keep the innermost one before
the 500 is built — and a raw JavaScript error's, on the worker's error path.
The bridge in `main.mjs` then lists the line under Problems as a `runtime`
problem, underlines it and puts the cursor there, the way a transpiler
error is pointed at; the frame keeps showing the framework's own error page.

## The Roundtrips tab

The **Roundtrips tab** (`src/shell/roundtrips.mjs`, `roundtripsTab()` in
`insight-roundtrips.mjs`, `tests/roundtrips.spec.js`) lists every request the app frame
sends and every answer it gets — the bridge in `main.mjs` records them on
the way through, timed around the worker's answer — with the event, what the
answer did (a view for a slot, a popup, a model update, a dump) and the
bodies as they travelled, the view XML one element per line. Cleared by
every Run, bounded at 200. The shapes it reads are the wire format
`app/webapp/core/Server.js` documents in the framework.

## The Console tab

What the app `WRITE`s (`src/shell/insight-console.mjs`, `tests/insight.spec.js`),
one block per roundtrip that wrote anything, headed by the roundtrip it came
with - the same number and event the Roundtrips tab lists it under, and the
roundtrip's detail there shows it too. On a system a WRITE in an abap2UI5 app
goes to a list screen nobody sees; here it is the quickest way to look at a
value. `roundtrip()` in `src/runtime/index.mjs` returns what WRITE put into
`abap.context.console` as `console` beside the answer and empties it every
time; `resetDatabase()` clears it on every Run, so a WRITE in a class
constructor (run while the classes are defined, before the first roundtrip)
is lost. The output lives on the roundtrips, so it is bounded with them and a
Run starts it afresh. The badge (`#console-count`) is a count, not a dot: the
output is the app talking, not something gone wrong, and it never takes the
panel the way a Log entry does - the Log stays quiet.

## The State tab

The app's attributes as the last roundtrip left them
(`src/shell/insight-state.mjs`, `src/runtime/app-state.mjs`,
`tests/state.spec.js`), after Roundtrips in the strip: inherited ones first,
static ones included, constants and interface attributes
(`z2ui5_if_app~id_draft`, rewritten every roundtrip) left out; each with its
type, visibility and value. Structures and tables open one level at a time,
references are named and never followed (a cycle would be a hang), and what
changed since the roundtrip before is tinted "changed" - a container with a
change inside opens by itself unless the reader closed it. Bounded where it is
taken: 4 levels, 20 rows of a table, 60 fields, 200 characters of a value,
1500 nodes in all.

It is read in the runtime worker, off the instance itself, not off the
framework's serialised draft (its own format, private and moving, and the
state as the NEXT roundtrip will restore it): `src/runtime/index.mjs` wraps
the handler's `main_end_save`, which every successful roundtrip reaches, and
hands the app to `snapshot( )`. Private attributes are JavaScript `#private`
fields and are read through `FRIENDS_ACCESS_INSTANCE` (see
[build-traps.md](build-traps.md), "tables of your own and the State tab").
The snapshot travels as the roundtrip answer's `state`, counts towards the
roundtrip budget, and is reset with them by every Run. Read-only: the app's
state is what the app made it.
