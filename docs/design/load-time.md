# Load time: what a visitor waits for

> Design notes, moved out of `AGENTS.md`. Read this before touching boot order, workers, preloads, the warm-up, the service worker or the size budget.
> The rules in short, and every other area, are in [AGENTS.md](../../AGENTS.md).

## What a visitor waits for

Five assets stand between opening the page and an app on screen, and
`tools/check-size.mjs` budgets those five among the nine files it holds: the page bundle with its chunks
(~1.0 MB compressed — Monaco, as a chunk of its own; the shell itself is
32 KB, budgeted on its own), the registry worker with the
linter's bundle beside it (~0.7 MB — abaplint, the transpiler and the
abap2UI5 linter), the transpiled
framework (~0.6 MB), the ABAP corpus (~0.4 MB) and SQLite (~0.3 MB). About three megabytes, and then
several seconds of processor to parse them. The same file carries a fifth
budget that is not a size at all — how much **JavaScript stack** the boot parse
may want, which is the third trap below. The budget for `samples/apps.json` names
how many samples it indexes, read from the built file itself rather than
hard-coded.

Measured on a built `dist/`, localhost, Chromium, from opening the page to
"running": 3.8 s before the round of changes that produced the shape below,
3.4 s after; with a 4x CPU throttle, 17.5 s → 14.6 s. What is left is the
corpus parse (about 2 s of it, 8 s throttled, and it is abaplint's), the
bundle's evaluation, and the app frame's own boot.

> **Read those numbers as a shape, not a target.** They were measured on one
> desk machine and are not reproducible on another - a different CPU moves
> them by more than any change described here. And the "4x CPU throttle" is
> Chrome DevTools Protocol's `Emulation.setCPUThrottlingRate`, which slows the
> **page's main thread only, not its workers**: since the framework and the
> registry moved into workers, a throttled run overstates what the page
> thread costs and understates the corpus parse and the framework's
> evaluation, which a real phone slows down as well. Compare before and after
> on the same machine, and do not compare a throttled number from before the
> workers with one from after.

Four things keep the wait
from being worse than it is, and all four have to be kept in step with the
code:

- **The framework and the abaplint registry each run in a worker, both
  started by an inline script at the top of `src/shell/index.html`** — before
  the shell bundle has arrived, so their downloads and evaluations move with
  the document and on threads of their own. The framework's evaluation (0.85 s
  on a desk, several seconds on a phone) used to sit on the page's thread in
  front of the corpus parse: throttled, the corpus had landed at 0.2 s and
  abaplint could not start on it until 7.1 s. The registry worker fetches the
  corpus itself and parses it beside Monaco's own start, and the global type
  pass abaplint runs synchronously at the end — half a second on a desk,
  several on a phone — no longer freezes the page; the page bundle lost
  abaplint and the transpiler to `editor/registry.mjs`. Everything the page
  asks the registry is a message (`src/editor/registry.mjs`), so an analysis
  is a round trip: `refresh()` answers with what was last known and
  `whenAnalysed()` delivers the fresh one; Run waits on `refreshNow()`; the
  Monaco providers (`src/editor/providers.mjs`) return promises, which Monaco
  allows. Every provider question carries the open files so the answer is
  for the text on screen - but a file the worker was already sent under the
  same version (Monaco's model id and version id, `host.version`) goes as
  `{ name, version }` alone, and only a new or changed one as text; the
  worker is the judge (`holdsVersion` in `registry-core.mjs`), answers
  `needsText` with the names it does not hold at that version - a fresh
  worker, a text a fix moved under it - and the client asks again with them
  in full, so a lost version costs one round trip and never a stale answer
  (`tests/editor.spec.js` watches the worker's door for both halves). Two consequences of starting that early, both held by
  `tests/site.spec.js`: what a worker says before the bundle is listening
  (`ready`, `corpus`, or an error) is buffered by the inline script and
  replayed by the client; and a worker script Chromium could not fetch fires
  **no** error event for a module worker, so each client probes it by `HEAD`
  — the runtime's at the one moment the page is waiting on a runtime that
  has not spoken, the registry's after ten seconds without its first word.
- **The preloads in `src/shell/index.html`.** The chunks `shell.mjs` imports
  statically (`modulepreload`, written by the build), and — added by the
  inline script, on every page but `?view=app` and `?view=full` — Monaco's
  chunk, which `editor.mjs` imports dynamically so that those two pages
  never fetch it (`?view=app` in [public-surfaces.md](public-surfaces.md)), and Monaco's stylesheet, linked outright on the
  same pages (a link added by script does not hold the first paint). Left alone each would
  arrive in a chain behind the file that asks for it. The corpus is not
  preloaded any more: the registry worker fetches it, and a document's
  preload does not reach a worker's fetch. Measured when the framework was still an import: no difference where
  bandwidth is the whole story (4 Mbit/s, 100 ms: 11.8 s either way), and
  about 10% where round trips cost anything (12 Mbit/s, 300 ms: 9.0 s →
  8.0 s; 50 Mbit/s, 40 ms: 5.8 s → 5.2 s). A preload that nothing collects is
  downloaded twice and warned about in the console, so if what the page
  fetches changes, these change with it — and that is why SQLite's `.wasm` is
  no longer preloaded: the worker fetches it, and a document's preload does
  not reach a worker's fetch. What reaches it is the **HTTP cache**, so the
  inline script that starts the two workers also starts a low-priority
  `fetch` of `runtime/sql-wasm.wasm` and reads the body — the same move
  `warm-up.mjs` makes for the app frame. Left alone, the runtime asked for
  the 0.3 MB only from `db-setup.mjs`, which runs after the whole of
  `framework.mjs` has downloaded and been evaluated; now the two travel side
  by side and the worker's own request is answered from the cache (on Pages,
  which serves with a max-age; the test server sends none on purpose, so a
  test can hold the asking and not the hitting). A cache that keeps nothing
  costs the one download it always cost.
- **The warm-up of the app frame** (`src/shell/warm-up.mjs`). Nothing asked
  for UI5 until Run set the frame's src, which is the last thing boot does —
  so the frame's megabyte and a half (the core, two library preloads, the two
  theme stylesheets, the component) started at the very end of the chain,
  after seconds of idle network. Once the corpus has landed the page fetches
  that list at low priority, into the HTTP cache the frame's own requests hit
  (Pages serves with a ten-minute max-age; the test server on purpose does
  not, so `tests/app.spec.js` holds the asking, not the hitting). The list
  mirrors what the frame loads first and may go stale harmlessly — it grew
  by `sap.ui.layout`'s English message bundle when the page started opening
  on Basics II, whose form is laid out with that library. The lazy preload
  carries the code and not the texts, and UI5 fetches a lazy library's texts
  with a **synchronous** request, which Chromium sends past the service
  worker: the HTTP cache the warm-up primes is the only cache that answers
  it. `tests/worker.spec.js` names it as the one request under `app/` a
  second visit's first app still makes, and holds the rest to the worker.
  It also carries the frame's second wave - the core's and `sap.m`'s texts,
  the locale data, the version file, the manifest, the full layout preload
  and its stylesheet, and the four fonts the first app draws in - each a
  round trip the frame only started once the one before had answered.
  **Not on the AI pages.** There the app frame is on an opaque origin
  ([runtime.md](runtime.md)), and Chromium gives such a frame's requests a
  one-off network isolation key: nothing it fetches comes out of, or stays
  in, the HTTP cache the page primed (measured - see
  [build-traps.md](build-traps.md)), and no service worker serves it. So
  `boot()` skips the warm-up where `frameIsolated` (`page.mjs`), those pages'
  frame loads UI5 from the network every time and is online-only, and the
  isolation stays on the two pages where a key is typed - the playground's
  frame stays same-origin for exactly this cache.
- **The service worker** (`src/shell/sw.js`, `tests/worker.spec.js`). Cache
  first, over an allow list, in a cache named after the build. Its own comment
  is the long form: what it caches (the core assets — the linter's bundle
  among them — and the chunks by name, Monaco's stylesheet among those,
  everything under `app/` except the frame's document — *with* the queries
  UI5 puts on its stylesheets and manifest, which name the build, not a
  moment), what it deliberately leaves live (the app frame's document, linked
  ABAP, the catalogues), and why it neither calls `skipWaiting()` nor claims
  the page that registered it. `boot()` in `main.mjs` registers it last
  thing, after the first run (`keepAssetsForNextTime( )` in `site-cache.mjs`,
  which also holds `discardCachedSite( )`). **A cached hit is verified before
  it is served**, too (`verifiedHit( )`, used by `serve()` and by
  `serveDocument()`'s kept copy): the build writes `ASSET_HASHES` (the
  `__ASSET_HASHES__` marker; the SHA-256 of every file under `assets/`)
  beside `CORE_HASHES` and `DOC_HASHES`, and a cached document, core asset or
  `assets/*` file whose bytes do not match is deleted and fetched again. The
  cache is not the worker's alone - any script of this origin can open it,
  and the playground's frame is this origin - so a share link's app could
  otherwise plant a script under the bundle's name for the next visit, the AI
  pages' included. Cost measured 2026-10-17: 70-210 ms of WebCrypto for the
  ~20 MB, off the page's thread. An unguessable cache name was refused
  (`caches.keys()` lists it to any same-origin script). The UI5 tree under
  `app/` is not covered (pinned by version, thousands of files). The runtime
  worker cannot open the cache at all (`src/runtime/lockdown.mjs`). **A core asset goes into the cache only if
  it hashes to the build** — `build-site.mjs` writes the SHA-256 of each
  unhashed core file into the worker beside the build id, and install and
  the on-miss path both check it, fetching past the HTTP cache at install.
  Without that, the minutes after a deploy — when GitHub Pages' CDN and the
  browser's HTTP cache answer some files from the old build and some from
  the new — filled a cache with the new shell beside the old framework,
  permanently and under the new build's name; the page then waited forever
  on a runtime that had loaded and had nothing to say. The page side of the
  same lesson is in `runtime-client.mjs`: a runtime that answers the HEAD
  probe with 200 and then stays silent for a minute is failed with a named
  error, and `boot()` answers that one by discarding every cache the site
  wrote and unregistering the worker before asking for a reload. **The two
  documents** — `index.html` and `app/index.html` — and **the catalogue's
  three files** — `samples/apps.json`, `catalogue.mjs`, `catalogue.css` —
  are the exceptions to cache-first: network first, so a deploy reaches the
  next visit, and the cached copy only when the network has nothing to say,
  and also when the network answers with something that is not ok (a 503
  while Pages is having a moment): a non-ok document answer is replaced by
  the kept copy when there is one (`tests/worker.spec.js`) - which is what lets the installed playground (`manifest.webmanifest`, the
  192 and 512 px icons rendered from the docs' logo) open and run offline;
  `tests/worker.spec.js` holds all three halves, the poisoned-cache visit,
  the poisoned catalogue and the offline run. The catalogue is network-first
  for a reason of its own: the nightly deploy that lists a sample merged
  today writes a worker identical to yesterday's when nothing else moved —
  same build id, same cache — so a cache-first copy of `apps.json` was
  yesterday's catalogue for every returning visitor, indefinitely. And the
  install step fetches past the HTTP cache (`cache: "reload"`) only for the
  two documents and the frontend's unhashed component bundle and bridge; the
  entries it can check against the build (`CORE_HASHES`) try the HTTP cache
  first and go past it only when that copy fails the check, and the hashed
  chunks and the version-pinned UI5 files come out of the HTTP cache - which
  used to cost a first visit about five megabytes over the wire a second
  time. The two documents are hashed into the worker too (`DOC_HASHES`, and
  `index.html`'s bytes into the build id): a reload does not let a waiting
  worker take over, so after a deploy a reload got the new document over the
  old worker's cached bundle - now a document that is not the worker's build
  is answered with the copy that build kept. The two AI pages
  (`ai/index.html`, `pilot/index.html`) run on the same bundle and are
  precached and hashed the same way (`DOCUMENTS` in `sw.js`, the list in
  `writeServiceWorker( )`) - a page left out of both lists is the mix this
  prevents, waiting for the next deploy. The
  frontend's own `navigator.onLine` check is answered "yes" by
  `frontend-bridge.js` for the same reason: the backend is the page around
  the frame.

**And `boot()` is caught as a whole** (the last statement in
`src/shell/main.mjs`). Its own try/catch covers the two slow starts and
nothing else; everything around that — the editor, the file strip, the panel,
the dialogs, the examples browser — is code that cannot fail on the machine it
was written on and does fail on somebody else's, and a throw there left the
page reading "loading the ABAP runtime…" for ever, with a stack in a console
nobody has open. That is how it was reported: a cache from before the hash
check above was serving one build's `assets/shell.mjs` under the next build's
`index.html`, and the older bundle reached for a control the newer document no
longer has. So a failure anywhere is said in the status line and written to
the Log — and where a service worker is serving the page, the cached site is
discarded and a reload asked for, the way the STALLED runtime is answered,
because that mix is the prime suspect. A page nothing is serving from a cache
says nothing about a cache it does not have.

**What that discard actually guarantees is the unregistration**, not an empty
cache, and the difference cost a CI run. A worker goes on controlling the page
it is already serving until that page unloads — so where the failure lands
early, with the page's own requests still in flight, `serve()`'s on-a-miss
path puts what it fetches back under the same cache name within a second of
the delete. That is harmless: nothing reads a cache but a worker, there is no
longer one, and the worker the next visit registers re-fetches every core
asset past the HTTP cache and checks it against the build. The STALLED failure
lands late, when the page has stopped asking for anything, and there the
delete sticks. `tests/worker.spec.js` holds each to the half that is true of
it, and the early one ends on the reload it asked for: nothing served from a
cache, and the playground up.

The registry parse is the processor half, and it is
[yielded on a clock](../../src/editor/registry-core.mjs) rather than on a count of
objects — now so the worker can report progress and answer between objects,
where it used to be so the page kept painting. The yield is a message posted
to ourselves, not `scheduler.yield()`: that one's continuation runs ahead of
ordinary tasks and starved everything else on the queue. Applying an edited
abaplint configuration goes through the same path, because changing a rule
dirties every object in the corpus and costs the whole parse again.

Two orderings in `boot()` keep those costs overlapping rather than stacking,
and both are easy to undo by accident:

- **Both workers' handles are picked up before anything is awaited**, and
  the app frame's warm-up is asked for the moment the registry worker says
  the corpus has landed, so it downloads during the parse. The abap2UI5
  linter's bundle is asked for earlier still, by the registry worker itself
  the moment it starts (`lint-core.mjs`), so it downloads beside the corpus
  and is evaluated between two objects of the parse. They used to be
  started after `startingFiles()`, which is instant for a draft or a sample
  and is two round trips to GitHub for a `?src=` link — the linked class, then
  the classes beside it — which is the path every Run button in the
  documentation takes. The preloads had the *bytes* moving with the document
  already; what still waited on the link was every bit of processor work
  behind them. The linter arriving after the first analysis is the one
  wrinkle: `boot()` waits on `loadLinter()`, which the worker answers when
  the bundle has landed, then invalidates the kept analysis and asks again;
  until then every file's answer is "no findings".
- **`buildRegistry()` takes the files as a promise, not a list.** The corpus is
  nine hundred objects and several seconds, and none of it depends on what the
  user is about to edit — so it parses against itself, and the handful of files
  the editor holds are added and parsed incrementally afterwards, which is the
  same move `updateFiles()` makes on every keystroke.

Anything started before its awaiter goes through `heard()`, which attaches a
no-op catch so a failure in that window is reported by the code that knows how
to report it rather than reaching the console as an unhandled rejection.

**One analysis, three readers** (`analyse()` in `src/editor/editor.mjs`). What
is wrong with the code, how much of it can be repaired, and what the panel
should show are the same walk over the same text, and they used to be three:
the editor's change handler, the page's `remember()`, and the panel asking
`fixableNow()` as it rendered. The walk is now kept under a key made of the
open models' version ids and a generation counter — so anything that changes
the text recomputes and a second reader of unchanged text does not. A checker
whose *configuration* changed under unchanged text is invisible to that key,
which is why the Config tabs call `invalidateAnalysis()` before asking again.
**And the walk is one message.** The worker's `analyse` op answers with
abaplint's diagnostics per file and its fixable count — one `findIssues()`
over the user's objects, grouped by file and mapped with abaplint's own
`Diagnostics.mapDiagnostic`; it used to be a language-server call per file
and `findIssues()` once more for the count — and, beside them, the abap2UI5
linter's answer per file: the findings, how many carry a fix, the views they
were reconstructed from and the linter's notes on them (`lint-core.mjs`).
The linter ran on the page's thread until then, over every open file on
every keystroke pause — 10 to 100 ms a file on a desk, several times that on
a phone, between the keystroke and the paint. Its eight-entry memo by source
moved with it, dropped when the settings change; the page's
`abap2ui5-lint.mjs` keeps the settings, validates them and tells the worker.

## Chunks hand in, never import the shell

Everything a first visit does not need on screen at once is a chunk asked
for later: the AI rooms, the samples browser, the Share dialog (with
`layout-editor.mjs`), the Compare dialog (`compare-dialog.mjs`, imported on
the first press by `original.mjs`), and the guided first steps
(`first-steps.mjs`, `learn-path.mjs`, asked for by `guides.mjs` after the
first run, so nothing at boot waits on them). **A chunk must not import a
shell module** (`editor.mjs`, `insight.mjs`, `file-sets.mjs`,
`deep-link.mjs`, …): esbuild gives every set of entry points that reaches a
module a chunk of its own, so such an import moves that shell code out of
`assets/shell.mjs` into a new shared chunk - one more request at boot, and a
shell budget that measures less than the shell. What a chunk needs is handed
to its setup function by the shell module that imports it (`guides.mjs`,
`original.mjs`, the Share dialog's raw-URL lookup from `main.mjs`). `ui.mjs`
and `share.mjs` are already shared with the Share dialog's chunk.

## Three traps the browser sets, and what they cost

All three were found the hard way and all three look like working code until
they are on somebody else's page, or on a phone.

- **`window.prompt()` and `window.alert()` are not shown at all in a
  cross-origin iframe.** Chrome has ignored them there for years. Naming a new
  file was a `prompt()`, so the `+` button worked everywhere except in an
  embedded playground — where it did nothing and said nothing, and an embedded
  playground is most of what this is. The name is now typed into the strip
  itself (`askForNewFile()` in `src/shell/files-ui.mjs`), and a rejected name
  goes to the status line, which is a channel an embedding page can see.
- **The app in the frame takes focus away from this page.** `sap.m` calls
  `_applyAutoFocusTo` when a page renders, and it lands on the parent
  document's focused element. So an input in the shell must never treat `blur`
  as "never mind": a roundtrip finishing while somebody was halfway through a
  file name deleted what they had typed. Escape is the way out of the naming
  input, deliberately and only.

- **The JavaScript stack is not the same size in every browser, and abaplint's
  parser is recursive.** Statements are matched by a tree of combinators, so a
  long statement is a deep stack — and abap2UI5's `src/01/03` is its UI5
  frontend generated into ABAP string constants, where a whole module becomes
  *one* statement of up to 1600 tokens joined with `&&`. Those 62 classes took
  the corpus parse from 130 KB of stack to over 610 KB. Node and Chrome hand out
  a little under a megabyte, so it worked on every desk; mobile Safari hands out
  less, and the parse threw `RangeError: Maximum call stack size exceeded` out
  of `boot()` before the page had started. It was reported as two lines of
  minified frames, because the report was `String(e.stack)` and only V8 puts the
  message in a stack — see `describeError()` in `src/shell/ui.mjs`, which is the
  half of this to keep even if the corpus changes again. The playground serves
  that frontend from `dist/app`, built from source, and never reads the ABAP
  copy; `writeCorpus()` in `tools/build-site.mjs` leaves the directory out and
  fails the build if it stops finding it, and `check-size.mjs` parses the
  shipped corpus in 256 KB of stack so a new blob fails there rather than on
  somebody's phone.

A fourth of the same family, in a library rather than the browser: **the
abap2UI5 linter's release option is `minUi5`, not `ui5`**, and an option it does
not know is ignored rather than refused. The playground passed `ui5` — so the
release in the **abap2UI5 lint** tab reported "applied", moved the problem count
by nothing, and left the linter on its own default floor. It had never once
changed what was checked. `settingsFor()` in `src/editor/abap2ui5-lint.mjs` is
the one place the tab's name and the linter's name are mapped, and
`tests/insight.spec.js` now holds the release to an actual finding
(`sap.m.Button ariaHasPopup`, which exists from 1.84) rather than to the tab
echoing back what was typed into it.

Anything reading or writing `localStorage` goes through `src/shell/storage.mjs`
for a third reason of the same kind: in Safari and Firefox with third-party
storage blocked — again, the embedded playground's normal case — the *access
itself* throws. `setUpSplitter()` reads the stored split in `boot()` before the
try/catch that reports a startup failure, so that throw left the page on
"starting…" with every control disabled and nothing said.
