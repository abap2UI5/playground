# The runtime: how a roundtrip reaches the framework

> Design notes, moved out of `AGENTS.md`. Read this before touching `src/runtime/`, `src/shell/frontend-bridge.js`, `src/shell/runtime-client.mjs`, `src/shell/frame-link.mjs` or the frames' half in `agent-hooks.mjs`.
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
the frontend's state - the Roundtrips tab is fed by `offerFrameBridge( )` in
`agent-hooks.mjs` - with one exception: the AI rooms ask the frontend to
send a roundtrip, to type a value and to say which slots are open, by
message (`call`, below; see [ai-pilot.md](ai-pilot.md)). `frontend-bridge.js` replaces `window.fetch` for exactly that one
request (comparing origin and pathname
only — the run counter lives in the query) and posts the body to the parent
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
frame is up (the `restart` call to `frontend-bridge.js`, asked by
`restartInPlace()` in `run.mjs` only when the frame's `state` report — asked
for fresh with a `state` call, not the last one of its 100 ms tick — says UI5
is up, the bridge restarts, the document is `complete` and on the
same pathname): the ComponentContainer that
ComponentSupport made is destroyed and made again on the new address. The
bridge reports UI5 as up once its core is there, which is before
ComponentSupport has made that container, so a restart asked in the gap
waits for the container (up to ten seconds, `whenContainerUp()`) rather
than being refused: refused, a Run right after a reload loaded the frame a
second time (`tests/run.spec.js`, two samples picked during a run).
Destroying it and making it again is what the frontend's own `Component.exit()`/`init()` are built for (an FLP
re-launch — every listener detached, the roundtrips in flight aborted, the
timers cancelled, the popup slots and the context destroyed), with what UI5
keeps in its static area outside any component closed by hand (a MessageBox,
a popover) and the hash cleared; the UI5 core, the libraries and the theme
are kept, which was most of what a Run waited for. The first Run, a frame on
another origin, one that never booted UI5 or carries an older bridge, and a
restart that fails or takes thirty seconds, load the document as before —
the one path there used to be, because a reload was the only thing that
reset the view slots, the routing and the component until the frontend
learned to. A loaded document counts as booted when its bridge reports
`ui5` within five seconds (`linkOf(frame).up(5000)`); which Run a roundtrip
belongs to is read from the `?run=` of the href the frame reports with it.
`tests/app.spec.js` holds a second Run to the kept document (a
mark on the frame's window survives it) and to nothing of the old app
surviving: its typed values, its hash, its draft. "Fresh" is SQLite reopened on an image of
the empty database taken once after the transpiled init seeded it
(`db-setup.mjs`) — under a millisecond, where rebuilding it from the DDL (27
tables, then 724 seed rows) was 85 ms per Run on a desk and several times that
on a phone. TADIR is not seeded at all (`populateTables` in
`build-framework.mjs`): nothing reads it, and its 760 INSERTs were about a
quarter of a second of every boot.

## The frame line: messages only

The page and an app frame never reach into each other: no
`window.parent.…`, no `contentWindow.…` read - the global the bridge once
read off the page (`window.__z2ui5Playground`) is gone, and
`tests/isolation.spec.js` holds that. `src/shell/frame-link.mjs` is the
page's half (`linkOf(frame)` with `.call( )`, `.up( )`, `.state`;
`frameApi( )` for the AI rooms; `serveFrames( )`, `tellFrames( )`,
`onFrameMessage( )`; `navigate( )`, a `location.replace( )`, which a page
may do to a cross-origin child), `frontend-bridge.js` the frame's. On the AI
Studio's and the AI Pilot's pages (`frameIsolated` in `page.mjs`) the frames
get `sandbox="allow-scripts allow-forms allow-popups allow-modals
allow-downloads"` - no `allow-same-origin`, so an opaque origin, and an
app's script reaches neither the key form nor the page's memory, storage or
`fetch` ([ai-chat.md](ai-chat.md)). There the bridge shims `localStorage`,
`sessionStorage` and `document.cookie` in memory, which throw on an opaque
origin and UI5 touches ([build-traps.md](build-traps.md)). Everywhere else
the frame stays same-origin, for the HTTP cache, the service worker and
offline ([load-time.md](load-time.md)), and speaks the same messages.

Every message is `{ z2ui5Frame: 1, type, … }`; the frame's carry `doc`, the
id of the document that sent it, so a late message of a replaced document is
ignored.

| Direction | `type` | Fields |
| --- | --- | --- |
| frame → page (to `location.origin`, which an opaque frame still knows by name) | `state` | `href, readyState, ui5, app, restarts, busy, slots, pending, seen` - pushed whenever it changes |
| | `roundtrip` | `id, body, href` - the frontend's POST |
| | `reply` | `id, ok, value, error` - the answer to a `call` |
| | `drop` | `files` - only where the page said it takes them |
| | `height` | `height` - only when `settings` asked (embedded `?view=app`) |
| page → frame (to `"*"`: an opaque origin has no name, so nothing secret is ever sent) | `answer` | `id, status, reason, body` or `id, error` |
| | `call` | `id, op, args` - `op`: `roundtrip`, `frontend`, `fill`, `carry`, `restart`, `state` |
| | `theme` | `theme` |
| | `hold` | `hold` - whether a `focus( )` in the frame is skipped (pushed, since the frame's focus is synchronous) |
| | `settings` | `takesFiles, height` |

The page takes a message only from the `contentWindow` of a registered
frame, with origin `"null"` for an isolated one and its own otherwise, and
refuses a roundtrip whose `?pilot=` tab is not that frame's own. The frame
takes one only from `window.parent` and the site's origin. The bridge's
own `__z2ui5PlaygroundPilot`/`__z2ui5PlaygroundRestart` remain on the
FRAME's window, for tests only.

## The runtime worker gives things up

The worker runs whatever ABAP the editor holds, `WRITE '@KERNEL …'` (plain
JavaScript) included, on the site's own origin. It has no DOM, no
`localStorage` and none of the page's memory, but it had the origin's
CacheStorage and IndexedDB - and the service worker answers from that cache.
`src/runtime/lockdown.mjs`, imported first by `worker.mjs`, deletes
`caches`, `indexedDB`, `Worker` and `SharedWorker` wherever the global's
prototype chain defines them and pins them `undefined`, read-only and
non-configurable on `self`; `navigator.serviceWorker` goes too. `fetch`
stays (sql.js loads its wasm with it; it reaches no storage) and so does
`navigator.storage` (nothing reads it). Nothing in the framework bundle names
any of them (checked). Behind it, the service worker hashes a cached hit
before serving it ([load-time.md](load-time.md)); `tests/worker.spec.js`
plants a forged `shell.mjs` and a chunk and sees neither run.

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

**An app from a table.** While a table or its rows is the file on screen, the
file strip offers **→ App** (`src/editor/app-from-table.mjs`,
`tests/app-from-table.spec.js`, `tests/node/app-from-table.test.mjs`): it
writes `zcl_<table>_app` - a list of the rows and a dialog to add, change and
delete one, the view in the house layout - puts it first beside the table, so
Run starts it, and runs it. The set it replaces is kept as a draft, the way a
sample picked over it is. The class is ordinary abap2UI5 the reader goes on
editing; it deletes by a `WHERE` on the key, never `FROM` a work area (see
[build-traps.md](build-traps.md)), and commits each change itself - abap2UI5
rolls back what a roundtrip leaves uncommitted, here as on a system. Hidden in
the studio, like **+ table**.

## WRITE and the app's state

Two things travel back beside each roundtrip's answer, both read in the
worker: `console`, what WRITE put into `abap.context.console` (emptied every
roundtrip, and cleared by `resetDatabase()` on every Run, so a WRITE in a
class constructor is lost), and `state`, the app's attributes, read by
wrapping the handler's `main_end_save` and `snapshot( )` in
`src/runtime/app-state.mjs`. The panel's Console and State tabs show them -
see [panel.md](panel.md).
