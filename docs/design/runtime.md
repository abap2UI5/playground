# The runtime: how a roundtrip reaches the framework

> Design notes, moved out of `AGENTS.md`. Read this before touching `src/runtime/`, `src/shell/frontend-bridge.js`, `src/shell/runtime-client.mjs` or the bridge in `main.mjs`.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## How the pieces meet at run time

At run time the pieces meet like this: the UI5 frontend runs in an iframe and
POSTs to its backend with a plain `fetch` — to the frame's own URL, because
the component starts with `checkLocal: true` in its component data (step 3
of [build-pipeline.md](build-pipeline.md)). That flag used to be `window.z2ui5.checkLocal`, set by the bridge
ahead of the bootstrap. abap2UI5#2777 removed the `window.z2ui5` global — the
frontend keeps its state per component now (`component.ctx.state`, on the
component ComponentSupport names `container-z2ui5`) — and `Component.init()`
reads the flag from its component data and from nowhere else, so a flag set
on the window is ignored, every roundtrip goes to the manifest's path, which
this site does not have, and nothing renders. Nothing in the playground reads
the frontend's state - the Roundtrips tab is fed by the bridge in `main.mjs`,
below - with one exception, on one page: the AI Pilot asks the frontend to
send a roundtrip, to type a value and to say which slots are open, through
`__z2ui5PlaygroundPilot` at the end of `frontend-bridge.js` (see [ai-pilot.md](ai-pilot.md)). `frontend-bridge.js` replaces `window.fetch` for exactly that one
request (comparing origin and pathname
only — the run counter lives in the query) and hands the body to the parent
page, which hands it to the transpiled handler — running in a **dedicated
worker** the page started (`src/shell/runtime-client.mjs`,
`src/runtime/worker.mjs`), so the framework's evaluation and every roundtrip
happen off the thread the editor paints on. It also makes the frame decline the focus while the
shell has a dialog open: UI5 focuses a control as a render settles, and
`showModal()` cannot make another document inert, so a frame that takes the
focus swallows what is typed into the dialog and the Escape that would close it.
The bar's search panel counts as a dialog here: it is modal as well, and the
`inert` it puts on the page does not keep a frame's own `focus()` out. So does
a field somebody is typing in on the page - the editor, the AI chat: an app's
first render focuses a field of its own, and the app Auto started, or the AI
ran, took the next keystrokes. Once the reader is in the app, the app has it.
The drafts abap2UI5 keeps in a database live in an in-memory SQLite — sql.js,
compiled to WebAssembly. Run means: a fresh database, then the app started
again in the iframe on `?app_start=<CLASS>&run=<n>` — **in place** where the
frame is up (`__z2ui5PlaygroundRestart` in `frontend-bridge.js`, asked by
`restartInPlace()` in `main.mjs`): the ComponentContainer that
ComponentSupport made is destroyed and made again on the new address, which
is what the frontend's own `Component.exit()`/`init()` are built for (an FLP
re-launch — every listener detached, the roundtrips in flight aborted, the
timers cancelled, the popup slots and the context destroyed), with what UI5
keeps in its static area outside any component closed by hand (a MessageBox,
a popover) and the hash cleared; the UI5 core, the libraries and the theme
are kept, which was most of what a Run waited for. The first Run, a frame on
another origin, one that never booted UI5 or carries an older bridge, and a
restart that fails or takes thirty seconds, load the document as before —
the one path there used to be, because a reload was the only thing that
reset the view slots, the routing and the component until the frontend
learned to. `tests/app.spec.js` holds a second Run to the kept document (a
mark on the frame's window survives it) and to nothing of the old app
surviving: its typed values, its hash, its draft. "Fresh" is SQLite reopened on an image of
the empty database taken once after the transpiled init seeded it
(`db-setup.mjs`) — under a millisecond, where rebuilding it from the DDL (27
tables, then 724 seed rows) was 85 ms per Run on a desk and several times that
on a phone. TADIR is not seeded at all (`populateTables` in
`build-framework.mjs`): nothing reads it, and its 760 INSERTs were about a
quarter of a second of every boot.

## Tables of your own

A database table is two files beside the classes (`src/editor/tables.mjs`,
`tests/tables.spec.js`, `tests/node/tables.test.mjs`): `<name>.tabl.xml`, the
abapGit TABL definition, and optionally `<name>.tabu.json`, the rows it starts
with - a JSON array of objects keyed by field name in either case, at most
1000 rows (`MAX_ROWS`). `tables.mjs` is the rows parser, the table check that
protects abaplint (it throws from its parse on a field with no type - see
[build-traps.md](build-traps.md)), the starter pair the **+ table** button
adds (`zproducts`, five rows) and the abapGit data configuration the export
writes. The transpile of the user's objects hands back exactly their
`CREATE TABLE`s; `src/runtime/index.mjs` creates them in the open database
and inserts the rows, each through the same INSERT an ABAP `INSERT ... FROM`
makes, so every value is converted under ABAP's rules and a row is refused
with its file, row number and field. A `MANDT` the rows leave out is filled
with the current client; SELECT has no client handling of its own. A table
may not reuse a DDIC name of the framework or of open-abap, and the runtime
keeps the DDIC put-back map beside the class one so a redefine restores
what the last set shadowed.

**Fresh at every Run, and never kept.** The tables are rebuilt from the text
in the editor on every reset - after it, on the empty image - and whatever an
app SELECTs, INSERTs, UPDATEs or DELETEs goes with the Run, exactly like its
drafts. That is the "Run starts fresh" promise of the deliberate limits, and
it holds for tables too. `?src=` still opens ABAP only; a gist carries both
files; the abapGit zip puts the TABL in `src/` (with its BOM) and the rows in
`data/` with their `.conf.json`, abapGit's own data layout. Closing a table
closes its rows file, and the editor shows the two in Monaco's XML and JSON
languages.

## WRITE and the app's state

Two things travel back beside each roundtrip's answer, both read in the
worker: `console`, what WRITE put into `abap.context.console` (emptied every
roundtrip, and cleared by `resetDatabase()` on every Run, so a WRITE in a
class constructor is lost), and `state`, the app's attributes, read by
wrapping the handler's `main_end_save` and `snapshot( )` in
`src/runtime/app-state.mjs`. The panel's Console and State tabs show them -
see [panel.md](panel.md).
