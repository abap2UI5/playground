# AGENTS.md

The abap2UI5 browser playground: a static page, published to GitHub Pages, with
Monaco and abaplint on the left and a real abap2UI5 app on the right. The ABAP
in the editor is transpiled to JavaScript in the browser and run against the
actual framework — transpiled at build time from a pinned commit — with nothing
behind it: no server, no SAP system, no backend of any kind.

**What is current and what is not.** [README.md](README.md) and this file
describe the playground as it is. [PLAYGROUND_PLAN.md](PLAYGROUND_PLAN.md) is
the plan it was built from and says itself that it is not maintained against
the code — but its **Findings** sections record every trap in the build and the
runtime (the transpiler flags without which nothing links, the type caches that
must be cleared on redefine, the `frameOptions` story) and still hold. Read
them before touching `tools/` or `src/runtime`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/shell/` | The page: boot and Run (`main.mjs`, which also owns the **Auto** switch beside Run - the debounce, the stored setting and the three reasons Run may be inactive), layout and splitter, toolbar, share links (`share.mjs`; the Share dialog in `share-dialog.mjs`, with the embed block, the markdown fence and the abapGit zip that `export.mjs` lays out and `zip.mjs` writes - stored entries, by hand, forty lines rather than a dependency), `?src=` deep links (`deep-link.mjs`), the samples browser over the sample catalogue (`examples.mjs`, reading the built index — a near-full-screen modal with the filters and the catalogue's three facets down its side), which UI5 library a control ships in (`ui5-libs.mjs`) beside the closed list of the ones this site carries (`ui5-libraries.mjs`), the bottom panel (`insight.mjs`), the syntax colour it prints XML and JSON in (`highlight.mjs`) and the View tab's edit mode - the builder chain read back out of the ABAP (`chain-read.mjs`), the edited document matched against the one that was shown (`view-edit.mjs`), the change put back as an edit to the ABAP that is there (`chain-patch.mjs`) and, when it cannot be, the chain written again in the house layout (`chain-write.mjs`), embed messaging (`embed.mjs`), light or dark (`theme.mjs` — the switch in the menu behind the bar's last button, applied as `data-theme` on `<html>` and handed to the editor and the app frame; `extra.mjs` is the six lines that close that menu), where the reader was on each of the neighbouring sites (`site-memory.mjs` — see "One site in three places" below), every `localStorage` touch (`storage.mjs` — bar one, the inline script at the top of `index.html` reading the stored theme before the first paint) and what is kept in it between visits (`checker-settings.mjs`), the page's handle on the ABAP runtime worker (`runtime-client.mjs`), the search box in the bar and the matcher under it (`search-box.mjs`, `search-engine.mjs` — one box over the documentation AND every sample, see "One site in three places" below), the warm-up of the app frame's first load (`warm-up.mjs`) and the favicon (`favicon.png`, `apple-touch-icon.png` — the docs' mark, rendered down) — `frontend-bridge.js`, the fetch interception injected into the app frame, and `sw.js`, the service worker that makes a second visit cheap |
| `src/editor/` | Monaco plus the abaplint registry — in a worker: `registry-core.mjs` and `transpile-core.mjs` are abaplint and the single-object transpile as they run there, `registry-worker.mjs` the worker's entry, `registry.mjs` the page's client with a promise in front of everything, `providers.mjs` Monaco's language providers answered over it — the abap2UI5 linter wrapper (`abap2ui5-lint.mjs`), the file set, and the samples the page carries - `sample-list.mjs`, which is nothing but the class names of a handful of apps in **abap2UI5/samples**, and `samples.mjs`, which pairs what the build resolved them into (`build/samples/`) with the ABAP itself |
| `src/runtime/` | The ABAP side of the page: the framework entry (`index.mjs`, `roundtrip()` and `defineClasses()`), `worker.mjs` around it, which is the bundle's entry and answers those over `postMessage` when it runs as the worker the page starts, the sql.js database (`db-setup.mjs`), and the browser shims for Node modules |
| `src/abap/` | The playground's own ABAP - `zcl_pg_bridge` and nothing else; it travels through the same downport and transpile as the framework. There was a `zcl_pg_hello` beside it, a copy of the hello world in **abap2UI5/samples**; the runtime tests drive the framework's own `z2ui5_cl_ui5_app_hi_world` instead, so this repository holds no app of its own to keep in step with one somebody else maintains |
| `src/examples/` | ABAP served as static files, so `?src=` has same-origin targets and the link tests depend on no foreign host |
| `src/embed/` | The embed loader (`abap2ui5-embed.js`) and a worked example page; copied verbatim to `dist/embed/` |
| `src/catalogue/` | The sample catalogue at `/samples/`: one page, one stylesheet, one module, over the index `tools/build-catalogue.mjs` writes. Its own document and its own bundle - see "The sample catalogue" below. `search-entry.mjs` is the second bundle out of this directory: the bar's search box, as the one file the catalogue and all 772 per-sample pages load |
| `tools/` | The build (`build.mjs`, which drives `fetch-deps`, `build-framework`, `build-ui5`, `build-catalogue` — which writes the index and, through `sample-pages.mjs`, one static page per sample plus the sitemap, with the ABAP on those pages fetched by `sample-sources.mjs` and coloured by `abap-highlight.mjs` —, `build-site`), the size budget (`check-size`) and the dev server (`serve`) |
| `tests/` | Playwright specs — the only test layer; everything is tested through a real browser against the built `dist/` |

`deps/`, `build/` and `dist/` are generated and gitignored. Never commit them.

**There are no samples in this repository.** There were - a dozen classes under
`src/samples/`, written here - and every one of them was a fork of a sample:
improved upstream and not here, or here and nowhere else, with nothing on the
page saying which. The samples the page carries now are named by class in
`src/editor/sample-list.mjs` and come out of **abap2UI5/samples**, pinned by
commit in `tools/fetch-deps.mjs`; `writeSamples()` in `tools/build-site.mjs`
resolves the names against that pin, copies the ABAP into `build/samples/` and
writes the index and the import module the bundle reads. Titles and blurbs come
out of that repository's own `catalogue.json`, so a carried sample reads exactly
as it does in the samples browser's other seven hundred rows - it *is* one of
them; the only difference is that it travelled with the page. A class named in
the list and missing from the pin fails the build with its name in the message.

## The build pipeline

`npm run build` is `tools/build.mjs`, which runs five steps, each cached by a
hash of its inputs, so only the first build costs minutes. Steps 2 and 3 run
**together** — they read different sources and write to different places, and
only steps 4 and 5 read what either produced — so a cold build costs the longer of
them rather than both. Their output is streamed with the step's name in front
of each line. Each step is still its own script and still runnable by name
(`npm run build:framework`):

1. **`tools/fetch-deps.mjs`** pins `abap2UI5/abap2UI5`, its published
   frontend, `open-abap-core` and `abap2UI5/samples` by commit SHA under
   `deps/`. Bumping a pin is editing the sha there — nothing else fetches
   source. The samples pin is the one that decides which code the page opens
   on, so a bump of it is a change to the site, not only to the toolchain.
2. **`tools/build-framework.mjs`** copies the framework plus `src/abap` to
   `build/downport/`, downports to v702 syntax (`abaplint --fix`, ~3 minutes,
   deterministic), transpiles, and esbuild-bundles the result with the runtime
   and the sql.js setup into `dist/runtime/framework.mjs`, from
   `src/runtime/worker.mjs` as the entry. The esbuild flags (`keepNames`, the
   injected `Buffer`, the console and crypto shims in
   `tools/esbuild-plugins.mjs`) are all load-bearing — the plan's phase 1
   findings explain each one. One plugin leaves something *out*:
   `generatedFrontendStubPlugin` puts a stub in the place of each of the 62
   `z2ui5_cl_ui5f_*` classes (the UI5 frontend held as ABAP string constants,
   1.7 MB of the 15 MB transpilat, read only by the GET branch of the http
   handler, which nothing here calls) — the transpile still sees the whole
   tree, only the bundle does not carry them. It keeps **two** stamps, not one:
   `downport.stamp` over the sources, and `output.stamp` over what the downport
   *produced* plus the transpiler, `src/runtime` and the esbuild plugins — so
   the transpile and the bundle (about a minute together) are skipped as well
   when nothing that feeds them moved. Both stamps also check that what they
   would have produced is still on disk, so a deleted `dist/` rebuilds rather
   than being cached into a missing site.
3. **`tools/build-ui5.mjs`** builds the abap2UI5 UI5 frontend against a pinned
   OpenUI5 (`UI5_VERSION` in `src/shell/ui5-libraries.mjs` — the page reads it
   too, for the warm-up's stylesheet URLs; from npm — no CDN) into `dist/app/`. The copy into
   `dist/app` is its own stamp (`app.stamp`, over the build's input hash and the
   two files `patchFrontend()` rewrites afterwards): it is 155 MB and tens of
   thousands of files, and it used to run on every build including the ones that
   had just reported the tree up to date. It rewrites
   `frameOptions="trusted"` to `"allow"` so the app renders inside somebody
   else's documentation page, and fails if the attribute is no longer there to
   rewrite. `UI5_LIBRARIES` (`src/shell/ui5-libraries.mjs` — shared with the
   examples browser, which filters catalogue entries by it) is the closed set
   of libraries the site carries.
4. **`tools/build-catalogue.mjs`** fetches the six committed catalogues of the
   three sample repositories and joins them into `dist/samples/apps.json`, the
   index behind the catalogue page and the examples dialog. Then, from that
   same index and before it is written, `tools/sample-pages.mjs` writes what it
   implies: one static page per sample under `dist/samples/<class>/`, the full
   list at `dist/samples/all/`, `dist/samples/sample.css` and
   `dist/sitemap.xml` - see "A page per sample" below. Those pages print the
   ABAP itself, which `tools/sample-sources.mjs` fetches one tarball per ref
   (a dozen requests for 770 classes, not one each) and `tools/abap-highlight.mjs`
   colours here rather than in the reader's browser. The one step that
   talks to the network at build time, and the one whose failure is survivable
   by design - a catalogue or a tarball that does not arrive costs what it
   carried and never the build; see "The sample catalogue" below for what
   degrades and why the index is built rather than fetched by the page.
5. **`tools/build-site.mjs`** bundles the page and, as a bundle of its own,
   the registry worker (`dist/editor/registry.mjs`: abaplint, the corpus
   parse and the transpiler, from `src/editor/registry-worker.mjs`), writes
   the editor's source corpus (`dist/editor/corpus.json`), copies examples and the embed kit, and
   writes `dist/sw.js` from `src/shell/sw.js` with an id for this build
   substituted into it. It deletes the directories it owns before writing.
   The page bundle is **split**: `assets/shell.mjs` is Monaco and abaplint,
   and what the page only needs later — the transpiler
   (`src/editor/transpile.mjs`) and the abap2UI5 linter with its UI5 metadata
   (`src/editor/abap2ui5-lint.mjs`) — is a chunk each, split off wherever the
   source says `import()`, downloaded during the corpus parse and evaluated
   when it lands. Two things follow from the hashed chunk names, and both are
   written by this step rather than by hand: the `modulepreload` tags for the
   chunks the entry imports statically (a marker in `index.html`; without them
   a static import is fetched after the bundle instead of beside it), and the
   list of chunks the service worker precaches (a marker in `sw.js`). The size
   budget is over `assets/*.mjs` as a sum, so a module that moved into a chunk
   has not gotten any smaller. Two loaders go with it: Monaco's icon font is
   copied out with a hashed name, and `.abap` is **text** — which is how the
   samples the page carries reach the bundle from `build/samples/`. They are real ABAP
   files rather than template literals inside JavaScript so that the samples
   browser can link a row to the ABAP, and `src/editor/samples.mjs` is their
   only importer; `src/editor/sample-list.mjs` is the half of the catalogue
   Node can read, which is what the tests import.

At run time the pieces meet like this: the UI5 frontend runs in an iframe and
POSTs to its backend with a plain `fetch`; `frontend-bridge.js` replaces
`window.fetch` for exactly that one request (comparing origin and pathname
only — the run counter lives in the query) and hands the body to the parent
page, which hands it to the transpiled handler — running in a **dedicated
worker** the page started (`src/shell/runtime-client.mjs`,
`src/runtime/worker.mjs`), so the framework's evaluation and every roundtrip
happen off the thread the editor paints on. It also makes the frame decline the focus while the
shell has a dialog open: UI5 focuses a control as a render settles, and
`showModal()` cannot make another document inert, so a frame that takes the
focus swallows what is typed into the dialog and the Escape that would close it.
The drafts abap2UI5 keeps in a database live in an in-memory SQLite — sql.js,
compiled to WebAssembly. Run means: a fresh database, then reload the iframe
with `?app_start=<CLASS>&run=<n>`. "Fresh" is SQLite reopened on an image of
the empty database taken once after the transpiled init seeded it
(`db-setup.mjs`) — under a millisecond, where rebuilding it from the DDL (27
tables, 724 seed rows) was 85 ms per Run on a desk and several times that on
a phone.

`PG_DEBUG=1` builds the page and framework bundles unminified with source maps;
without it neither ships one.

## What a visitor waits for

Five assets stand between opening the page and an app on screen, and
`tools/check-size.mjs` budgets all five: the page bundle with its chunks
(~1.1 MB compressed — Monaco in `shell.mjs`, the abap2UI5 linter as a chunk),
the registry worker (~0.5 MB — abaplint and the transpiler), the transpiled
framework (~0.6 MB), the ABAP corpus (~0.4 MB) and SQLite (~0.3 MB). About three megabytes, and then
several seconds of processor to parse them. The same file carries a fifth
budget that is not a size at all — how much **JavaScript stack** the boot parse
may want, which is the third trap below.

Measured on a built `dist/`, localhost, Chromium, from opening the page to
"running": 3.8 s before the round of changes that produced the shape below,
3.4 s after; with a 4x CPU throttle, 17.5 s → 14.6 s. What is left is the
corpus parse (about 2 s of it, 8 s throttled, and it is abaplint's), the
bundle's evaluation, and the app frame's own boot. Four things keep the wait
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
  allows. Two consequences of starting that early, both held by
  `tests/site.spec.js`: what a worker says before the bundle is listening
  (`ready`, `corpus`, or an error) is buffered by the inline script and
  replayed by the client; and a worker script Chromium could not fetch fires
  **no** error event for a module worker, so each client probes it by `HEAD`
  — the runtime's at the one moment the page is waiting on a runtime that
  has not spoken, the registry's after ten seconds without its first word.
- **The preloads in `src/shell/index.html`.** The chunks `shell.mjs` imports
  statically (`modulepreload`, written by the build). Left alone each would
  arrive in a chain behind the file that asks for it. The corpus is not
  preloaded any more: the registry worker fetches it, and a document's
  preload does not reach a worker's fetch. Measured when the framework was still an import: no difference where
  bandwidth is the whole story (4 Mbit/s, 100 ms: 11.8 s either way), and
  about 10% where round trips cost anything (12 Mbit/s, 300 ms: 9.0 s →
  8.0 s; 50 Mbit/s, 40 ms: 5.8 s → 5.2 s). A preload that nothing collects is
  downloaded twice and warned about in the console, so if what the page
  fetches changes, these change with it — and that is why SQLite's `.wasm` is
  no longer preloaded: the worker fetches it, and a document's preload does
  not reach a worker's fetch.
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
- **The service worker** (`src/shell/sw.js`, `tests/worker.spec.js`). Cache
  first, over an allow list, in a cache named after the build. Its own comment
  is the long form: what it caches (the core assets and the chunks by name,
  everything under `app/` except the frame's document — *with* the queries
  UI5 puts on its stylesheets and manifest, which name the build, not a
  moment), what it deliberately leaves live (the app frame's document, linked
  ABAP, the catalogues), and why it neither calls `skipWaiting()` nor claims
  the page that registered it. `main.mjs` registers it last thing in
  `boot()`, after the first run. **A core asset goes into the cache only if
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
  documents** — `index.html` and `app/index.html` — are the one exception to
  cache-first: network first, so a deploy reaches the next visit, and the
  cached copy only when the network has nothing to say, which is what lets
  the installed playground (`manifest.webmanifest`, the 192 and 512 px icons
  rendered from the docs' logo) open and run offline; `tests/worker.spec.js`
  holds both halves, the poisoned-cache visit and the offline run. The
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
[yielded on a clock](src/editor/registry-core.mjs) rather than on a count of
objects — now so the worker can report progress and answer between objects,
where it used to be so the page kept painting. The yield is a message posted
to ourselves, not `scheduler.yield()`: that one's continuation runs ahead of
ordinary tasks and starved everything else on the queue. Applying an edited
abaplint configuration goes through the same path, because changing a rule
dirties every object in the corpus and costs the whole parse again.

Two orderings in `boot()` keep those costs overlapping rather than stacking,
and both are easy to undo by accident:

- **Both workers' handles are picked up before anything is awaited**, and
  the linter chunk and the app frame's warm-up are asked for the moment the
  registry worker says the corpus has landed, so they download during the
  parse. They used to be
  started after `startingFiles()`, which is instant for a draft or a sample
  and is two round trips to GitHub for a `?src=` link — the linked class, then
  the classes beside it — which is the path every Run button in the
  documentation takes. The preloads had the *bytes* moving with the document
  already; what still waited on the link was every bit of processor work
  behind them. The linter arriving after the first analysis is the one
  wrinkle: `boot()` invalidates the kept analysis and asks again when it
  lands, and `abap2ui5-lint.mjs` answers "no findings" until then.
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

## On a phone

Below 820px (`src/shell/shell.css`, one media query; `setUpTabs()` in
`src/shell/layout.mjs`) the split becomes two tabs, ABAP and App, because half
of a phone is not a pane. Two more things follow from the same arithmetic, and
both are easy to undo by tidying up:

- **The bar compacts rather than wrapping.** At desk width it is one row; on a
  phone it wrapped to four — a fifth of the screen, spent before the editor or
  the app got any of it. What repeats itself goes (the brand and the version
  line, which the About dialog carries as well), the paddings shrink,
  and the `.spacer` that holds the right-hand group at the edge is dropped so
  it stops pushing the last control onto a row of its own. The nav and the two
  marks at the far end go as well (the catalogue drops its own below 620px);
  the theme button stays. Nothing else is *removed*: every control is still
  there and still reachable, which is what `tests/shell.spec.js` holds it to,
  along with the height. **Above that width the bar sheds the same kind of
  thing one at a time** rather than all at once, at the three widths where the
  row would otherwise wrap — measured, not chosen: the version line at 1560,
  the brand's word at 1440 (the mark stays, and the nav's bold item says
  "playground" anyway), the nav at 1280. So it is one row from 989px up, where
  before the nav arrived it was one row from 1143px.
- **The panel starts folded away** (`setUpInsight()` in `src/shell/insight.mjs`).
  It is a fixed 11rem under an editor that has about 25 to give, so on a narrow
  screen it opens collapsed to its tab strip — where the Problems badge still
  carries the count, so it says whether it is worth the room before taking any.
  Folded or open is remembered from then on
  (`abap2ui5-playground:insight-collapsed`), and only when somebody *said* so:
  the panel opens itself when something is written to the log, and a failure
  taking the screen is not a request to have it open tomorrow. The strip carries
  a **toggle** at its far end — clicking the open tab has always collapsed the
  panel too, but nothing on the screen said so — and the five tabs scroll among
  themselves underneath it, so the control that gives the room back never
  scrolls out of reach. Where the pointer is a finger (`(pointer: coarse)`) the
  strip grows to a height a finger can hit and the toggle to a width one can,
  and the toggle's hit area reaches up past the resize grip, which otherwise
  sits over its top edge and turns a tap that lands there into a drag of
  nothing; `tests/insight.spec.js` taps it under touch emulation.
- **Run brings the app forward**, the way picking a sample always did: with one
  pane on screen, pressing Run and being left looking at the code is a dead end.
  `run()` answers whether it got as far as starting an app, and only then does
  the caller switch — a run that stopped on an abaplint error left the problems
  list open, and that is what the reader has to be looking at. Both halves are
  in `tests/shell.spec.js`; the same `if (started)` guards a sample picked in
  the examples browser, which had switched either way.

**Auto, the switch beside Run** (`main.mjs`, `tests/shell.spec.js`). On, Run
itself goes inactive — there is nothing left for it to do — and every change
to the ABAP starts the app again 700 ms after the typing stops. Off by
default, because a run is a fresh database and a full reload of the app frame,
which throws away whatever was on screen: not what somebody halfway through a
form in their own app wants, and exactly what somebody watching a view take
shape wants. Three details are easy to undo by tidying up: Run's disabled
state has three reasons now (the page has not started, a run is under way,
autorun has the job) and they are decided in one place, because a run
finishing under autorun used to hand the button back; a run of any kind
clears the pending timer, so opening a sample is not followed by a second run
of the same text; and a change that arrives while a run is under way is run
after it rather than dropped. It follows the storing rule the theme and the
checker settings follow — kept only while it differs from the default, and
never restored in an embedded playground. Autorun does not bring the app
forward on a phone the way pressing Run does: it fires while somebody is
typing, and taking the editor off the screen mid-word is not what they asked
for.

## Format

The `{ }` in the bar and Shift+Alt+F are **one** implementation —
`formatFiles( )` in `src/editor/registry-core.mjs`, run in the worker, reached
from the button through `format( )` in `src/editor/editor.mjs` and from the key
through the document-formatting provider in `src/editor/providers.mjs`. Two
ways in with two ideas of what formatting means is a bug somebody finds by
pressing the other one.

It is abaplint's pretty printer with abaplint's **layout fixes in front of
it**. The printer is two things and only two — keyword case and indentation —
so Format used to leave a tab, a trailing space, a double space, a `.` with a
space in front of it and two statements sharing a line exactly where they were.
The rules that repair those are ordinary abaplint rules with fixes, and
`FORMAT_RULES` there is the list: layout only, and separate from the rule set
the Config tab decides — somebody who turned a rule off to stop being nagged
did not thereby ask for their code to keep its tabs. Fixes, then print, then
round again, in a registry of its own holding the user's files and nothing
else: these rules need no corpus, and reconfiguring the registry that holds one
would be several seconds of reparse on a press of Format.

What is left OFF the list is the load-bearing half. `keyword_case` and
`indentation` are the printer's own job, and applied as edits beside it they
corrupt the source — both are computed against the same offsets and applied one
after the other. `align_parameters`, `line_break_multiple_parameters` and
`keep_single_parameter_on_one_line` each take an abap2UI5 builder chain and
break every `)->a( n = … v = … )` line into two; a formatter that reformats the
house style is one nobody presses twice. And nothing on the list changes what
the code does: obsolete-statement rewrites, `prefer_inline` and the rest stay
behind **Fix them** in the Problems tab, which says how many and why.

Format runs over **every open file**, not the one on screen — a class and its
test include are one piece of work — one edit per file, so Ctrl+Z takes the
whole thing back; the status line says how many files changed, or *already
formatted*. `tests/format.spec.js` holds all of it, the chain that has to come
back byte for byte included.

## The two checkers, and the Fix-them contract

- **abaplint** (`src/editor/registry.mjs`) answers *does this compile*, against
  the real framework sources at release v750, with a deliberately small rule
  set — only rules that answer "would this work", never house style. An
  abaplint error blocks Run.
- **The abap2UI5 linter** (`src/editor/abap2ui5-lint.mjs`,
  `@abap2ui5/linter`) reconstructs the view the builder chain produces and
  checks it against UI5 **1.71**, the floor abap2UI5 holds its shipped apps to.
  A finding does not block Run: the app runs and is wrong somewhere, and
  looking at it is the fastest way to understand the finding.

Both configurations are live in the panel's **abaplint** and **abap2UI5 lint**
tabs (`src/shell/insight.mjs`); the defaults stay the curated lists. Every
Problems row links the page that explains its rule (`rule ↗`, outside the row's
button): rules.abaplint.org through the `codeDescription` abaplint's
diagnostics carry, the linter's rules page through `ruleUrl( )` in
`src/editor/abap2ui5-lint.mjs` — the finding's own `url` where the pinned
linter sets one, the page's `#<rule-id>` anchor where it does not. The Monaco
markers carry the same link as their `code`, which is the shape abaplint's
already had. The two
use separate Monaco marker owners — sharing one would have each erase the
other's underlines.

A changed configuration is kept in `localStorage` (`src/shell/checker-settings.mjs`
— the checkers hold and validate a configuration, the *page* decides to remember
one) and restored in `boot()` *before* the corpus is fetched, because abaplint's
half decides how the corpus is parsed and restoring it afterwards would parse
nine hundred objects twice. Three rules go with that: a stored setting is validated exactly like a typed
one and silently dropped when it stops making sense (a rule abaplint has since
retired); a setting that equals the default is **forgotten rather than stored**,
so the curated lists can move between deploys and reach somebody who pressed
Reset; and an embedded playground never restores either — a demo in somebody's
documentation has to read the same to every reader, the same reason it never
restores a draft.

The **theme** follows the middle rule too (`src/shell/theme.mjs`): the button
at the bar's right-hand end — the sample catalogue's button, in the catalogue's
own end group (the nav, the button, a hairline, LinkedIn and GitHub) — stores a
choice only while it differs from what the system says, so a page switched back
follows the system again, and an embedded playground never restores one.

The **View tab** (`viewPreview()` in `src/shell/insight.mjs`) shows the XML
the linter reconstructs from the open file's builder chain — `viewsFor()` in
`abap2ui5-lint.mjs`, the same reconstruction the findings come from, put one
element per line by `xml-pretty.mjs` and coloured by `highlight.mjs`. It is a
second reconstruction beside the analysis pass, run only while that tab is
open; the tab says so when the linter has not loaded yet and when the file
builds no view.

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
because the `v =` column is aligned across it; anything that changes the shape
of the view, a control added, removed or renamed, falls back to
`chain-write.mjs` and the full single-chain rewrite, which is what it always
did. The patch runs only when the two trees are provably the same tree, node
for node and attribute for attribute, so leaving the surrounding ABAP alone is
the correct rewrite rather than a cheaper one. `tests/view-edit.spec.js` holds
the three cases: one value changed and the file otherwise byte for byte what it
was, Save with nothing changed changing nothing, and an attribute added and
taken out again arriving back at the file that was there.

What it will not do it says instead of guessing: a view built with a LOOP or an
IF, a control name held in a variable, two views in one method, a variable used
after the chain, text between two tags (the builder sets attributes; it has no
call for a text node), a value with a line break in it. The button is disabled
with that sentence as its title. While the editor is open the ABAP editor is
read-only (`setEditorReadOnly()`) — the ABAP is derived from the XML for as
long as it is, and two editable copies of one view would mean deciding which is
the truth on every keystroke. It also *looks* read-only: the same call puts
`is-readonly` on the editor pane and `shell.css` greys the source back and
takes the caret away, because Monaco's read-only state is otherwise
indistinguishable from its editable one — same colours, and a caret that still
lands where it is clicked — and nobody should have to type into it to find out
that it will not take it.

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
the **Tests** tab (`testView()` in `insight.mjs`) lists them — a failure
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

The **Roundtrips tab** (`src/shell/roundtrips.mjs`, `roundtripView()` in
`insight.mjs`, `tests/roundtrips.spec.js`) lists every request the app frame
sends and every answer it gets — the bridge in `main.mjs` records them on
the way through, timed around the worker's answer — with the event, what the
answer did (a view for a slot, a popup, a model update, a dump) and the
bodies as they travelled, the view XML one element per line. Cleared by
every Run, bounded at 200. The shapes it reads are the wire format
`app/webapp/core/Server.js` documents in the framework.

The **draft** follows the middle rule for the same reason: a file set identical
to one of the samples the page carries is not stored (`isSample()` in
`src/editor/samples.mjs`, applied in `remember()`). Reading a sample is not work
to continue, and storing it as a draft pinned that visitor to a frozen copy of
it — the sample was improved in a later deploy and they went on being opened on
the old one, findings and all, labelled "from your last session". One keystroke
makes it a draft again, and `tests/shell.spec.js` holds both halves.

What it does **not** do any more is delete the draft that was there. A sample
used to go into the editor as an undoable edit — every sample the playground
carried was called `zcl_playground.clas.abap`, so `setFiles()` reused the model
and the reader's work stayed one Ctrl+Z away. The samples come out of
abap2UI5/samples now and bring their own class names, so the model the work was
in is disposed with its file and Undo cannot reach it. `replaceWith()` in
`main.mjs` works out which of the two happened and the status line says the true
one — *one Undo away* or *comes back if you reload* — and the stored draft is
what makes the second sentence true.

**Fix them** (`applyFixes()` in `src/editor/editor.mjs`) applies both checkers'
fixes to everything open: abaplint's structural fixes first, then the linter's,
each in a bounded loop because one fix uncovers the next. The rewrite is
written back through `pushEditOperations` as **one edit per file**, so a single
Ctrl+Z takes the whole thing back. Nothing without a correct answer is guessed
at — an icon that does not exist stays reported. Keep all of that true when
changing anything near it.

## The public surfaces — the docs site consumes these

These are contracts, not conveniences: **abap2UI5/docs** puts Run buttons and
embedded demos under its examples using exactly these. A docs change that
depends on *new* playground behaviour must ship **after** the playground
deploy — readers get the published playground, never your checkout.

- **Share links**: every open file in the URL fragment, deflate-raw and
  base64url with a version prefix (`src/shell/share.mjs`). The fragment never
  leaves the browser. A fragment the playground cannot read is treated as
  somebody else's link and silently replaced by the sample — which is why an
  external page must build URLs with `window.abap2ui5Embed.url()`, never by
  hand.
- **`?src=<url>`** (`src/shell/deep-link.mjs`): opens ABAP from same-origin or
  GitHub's raw hosts (`raw.githubusercontent.com`,
  `gist.githubusercontent.com`) — an allow list on purpose, not an open read
  proxy. A `github.com/<o>/<r>/blob/<ref>/<path>` page URL, which is what a
  reader copies out of the address bar, is translated to the raw file behind
  it before the list looks at it (`rawFor()`). Several `src` parameters open
  several files; **the first file is the
  app**. Classes the app needs are looked for beside it: siblings only, at most
  6 files, 2 levels deep, silent when a name is not found.
- **`?embed=1`**: drops the chrome, and never reads or writes the stored
  draft — an embedding must not overwrite a reader's work.
- **`?view=app`**: hides the editor too — the app on its own, for a paragraph
  about what an app does rather than how it is written. **`?view=full`** is the
  same view under the name the Full screen button opens it by. Neither carries
  the bar: everything it offers is a click away in the "open this in the
  playground" link an embedding page prints beside the frame, and what it did
  instead was put a strip of this site's furniture across somebody else's
  paragraph. It returns while the status line reports an error, because it is
  the only channel that mode has left.
- **The Samples button** (`src/shell/examples.mjs` — the ids and the module
  keep the older name). A **big modal**: near enough the whole viewport, the
  page behind it dimmed and blurred, the filters in a side of their own and the
  rows in as many columns as the width allows. It is a list of 770-odd samples
  and it used to be a 44rem column of one-line rows, which is a keyhole onto
  one. It lists the reader's own **named drafts** first
  (`src/shell/drafts.mjs`, `tests/drafts.spec.js` — a name and Save keep
  what is open under it in localStorage, fifty at most, opened and deleted
  where they are listed; the one unnamed draft `remember()` keeps is
  unchanged), then the samples the page carries, then everything the catalogue holds:
  the learning path in its own reading order, the ports grouped by library,
  the stack samples by technology. It reads **one file, and it is this site's
  own** — `samples/apps.json`, written at build time by
  `tools/build-catalogue.mjs` (below). It used to fetch the three
  repositories' catalogues itself from `raw.githubusercontent.com` and shape
  them here; the catalogue page needs the same list in the same shape, and two
  implementations of one list is exactly the drift those repositories avoid by
  generating their views from one scan. Every row links to its **ABAP** on
  GitHub, and a carried sample to the same file in abap2UI5/samples; it used to link to
  `src/editor/samples.mjs`, so a reader asking where the code lives landed in
  the JavaScript that quoted it. Down the side are the filters, kept
  between visits: the three repositories as one tinted group (Learn, Controls,
  Stack — on), "Only what runs here" (off; on, it drops what needs a system or
  a library this build has not got), "OpenUI5 only" (off; on, it drops what
  needs SAPUI5) and "newer than 1.71" (on; off, it drops what needs a UI5 above
  the floor) — and, at the foot of it, the link to the catalogue page, which is
  where a search that is worth keeping goes. Under the boxes are the catalogue
  page's own three **facets** — *uses control*, *library*, *runs on UI5* —
  filled from the index and kept the same way. They are the two questions the
  sample repositories' catalogues cannot answer and the reason the index
  carries the linter's derived half at all, so the dialog asks them rather than
  sending the reader to the page for them; the built-ins and the drafts drop
  out under a facet, because a row the index knows nothing about is not a match
  for one, where under a box they stay — every box is about the repositories.
  The **search** takes several words, in any order, and matches a row's
  controls, libraries and group as well as its title and summary. A row is two
  lines: what it is called, with the group, the release where it is above the
  floor and what it needs where it cannot run (the long form as the badge's
  tooltip), then what it does and the class it is — beside it the link to its
  ABAP and, where the repository has one, to its documentation page.
  A chosen entry becomes the raw URL of its class and goes through the `?src=`
  loading path above — there is one loader, and this is a menu in front of it.
  Nothing is fetched before the button is clicked; no index means the carried samples
  and the drafts alone, silently. Rows that cannot run here are listed and say
  why, their buttons disabled — a sample somebody cannot find is worse than one
  they cannot run — and *which* rows those are is decided once, at build time,
  not judged here. Everything else is run and judged by the two checkers and
  Run, exactly like typed code; a catalogued sample the transpiler cannot
  compile fails visibly there, and that is the designed behaviour, not a bug.
- **`embed/abap2ui5-embed.js`**: turns an element into a click-to-load demo —
  `data-src` (one URL or several, first is the app), `data-code` (inline ABAP;
  the file is named after the class in it), `data-view`, `data-height`,
  `data-label`, `data-auto`. `window.abap2ui5Embed.setUp()` for pages that swap
  content without reloading. The frame posts `ready`, `status` and `height` to
  its parent. Click-to-load is deliberate: every demo boots its own runtime and
  parses the whole corpus.

**And one measurement that runs the other way.** abap2UI5/docs decides which of
its examples carry a Run button and gates the bookkeeping around it, but says
plainly in its own AGENTS.md that whether a buttoned example *starts* is the one
question its CI cannot answer — only a playground can, and a playground is a
build of this repository. `tests/docs-examples.spec.js` is that half: hand it
the worklist (`npm run runnable -- --json` in a docs checkout) and it opens
every example here and checks the status line and the app frame.

```sh
RUNNABLE_JSON=/tmp/runnable.json npm test -- docs-examples
```

It is **not part of `npm test`** — no worklist, no tests — because it is a
measurement rather than a gate: the input lives in another repository and the
run takes minutes. A failure is not automatically the documentation's, either.
An example may name framework API newer than the commit `tools/fetch-deps.mjs`
pins, and then the playground is right to refuse it and the pin is what moves.

## The sample catalogue — `src/catalogue/`, at `/samples/`

**<https://abap2ui5.github.io/playground/samples/>** — every sample of
`abap2UI5/samples`, `abap2UI5/samples-controls` and `abap2UI5/samples-stack`,
searchable. It is a **second document** on this site, with its own small bundle
(~7 KB): a reader who came to look something up must not download Monaco and
abaplint to do it, and a reader in the editor must not carry a page they may
never open. The two share `src/shell/ui5-libs.mjs` and the theme key, and that
sharing is why the page is bundled at all rather than copied.

It replaced three GitHub Pages sites, one per sample repository, retired
2026-09-03. Three pages that each had to explain that the other two existed
were the reason for a shared navigation block, its three copies and a check
policing the copies; one page needs none of it.

**What it has that the dialog cannot.** Its filters live in the URL
(`?q=table&lib=sap.m&rel=1.84`), so a search can be linked, sent or bookmarked
— and the page is a document with real text in it, so it can be found at all. A
list that arrives from another host after a click is invisible to a search
engine and has nothing to link to, which is why the index is built rather than
fetched (below). Its facets are the two questions the sidecars cannot answer:
*which samples BUILD `sap.m.Table`* — not the one filed under it — and *what
renders on the release my system runs*.

**`tools/build-catalogue.mjs`** writes `dist/samples/apps.json` before
`build-site` runs. It fetches **six committed files**, two per repository, and
joins each pair on `class`:

| | |
|---|---|
| `catalogue.json` | what that repository's tree holds |
| `catalogue-derived.json` | what the abap2UI5 linter knows: every control the class BUILDS, and the minimum UI5 release that implies |

Those files are the contract with the three repositories. The **library** a
control ships in is in neither of them and is decided here
(`src/shell/ui5-libs.mjs`): it is one UI5 taxonomy question, three repositories
each answering it would be three prefix tables that drift, and this is where
the question is actually asked — `UI5_LIBRARIES` beside it is the closed set
this site carries, so "does this render here" is that set against this mapping.
`runs` and `needs` are computed once, at build time, from that plus
`UI5_VERSION`; the page and the dialog only display them.

**It degrades per repository and per half.** No `catalogue.json` and that
repository contributes nothing and says so in `sources`; no
`catalogue-derived.json` and its samples are listed with the tree's facts and
without the derived ones. Neither is a failed build, and both are states that
really occur — the second is exactly the window between merging the playground
change and merging the three repository changes. A build with no catalogue at
all still publishes: the page says the catalogue could not be loaded, which is
the honest thing for it to say, and nothing else on this site depends on it.

**The deploy runs nightly** (`.github/workflows/pages.yml`), which a static
site would not otherwise need: the six files change when a sample is merged in
another repository, and that is no reason for anything to be pushed here.

**A card is one link, and it goes to the sample's own page.** Cards used to end
in three actions — Run it, Source, Docs — and they were the wrong three: they
left the site before the reader had seen what the sample *was*, and they made
the row look like the destination, so the page underneath it read as something
that did not exist. A card now carries the title (the link, stretched over the
whole card by `.card h3 a::after`, so a row is aimed at as a row), the badges,
the class, and one line saying what opening it gets — *Open the sample ›* and
whether it runs in this browser. Run, GitHub and the documentation are on the
page it opens, where a reader who has decided is standing — running it is a
demo box above the class that runs it *in* that page, and GitHub and the
documentation are facts in its list of facts. The one row that keeps a link of
its own is one with no page written for it: it links to the class on GitHub,
because that is all there is.

**The round trip is the point.** *Switch to Playground with this code* on a
sample's demo box goes to `../../?src=<raw>&from=catalogue&back=q=<class>` — in
this tab, which the label says — and `showSourceLink()` in `src/shell/main.mjs`
turns that into *Back to the catalogue* in the bar, narrowed to the sample they
came from, instead of pointing at the file on GitHub. Find it here, read it there, run it, come back and keep
looking. A static page cannot know the search a reader had, which is the one
thing this lost when Run moved off the card; `q=<class>` is the search with
exactly one hit. A `?src=` link from anywhere else still offers the GitHub
page, which is what that reader wants.

**The bar names the part of the site you are in.** On `/samples/` and on every
per-sample page the brand is the mark and *abap2UI5*, closed by a hairline
(`.brand::after`, 16px from the name like the two lines at the other end) —
nothing more, because the nav's Samples carries `aria-current`, which is what
makes it the bold item (`catalogue.css`) and what a screen reader announces,
and a brand that said *samples* too said it twice. The brand links to the catalogue rather than to
the playground, which is one nav item away; a bar that called these pages
"playground" was naming the neighbour rather than the room.

**The samples pages' right-hand end reads, in this order:** a hairline, the
nav — *Documentation*, *Samples*, *Playground* —, a hairline, LinkedIn and
GitHub, then one more button, drawn as a third mark, that opens **the menu**:
the light-or-dark switch, then the project's tools (linter, VS Code extension,
MCP server, app template, add-ons) and its repositories on GitHub — the list
the documentation's own Links menu carries. The menu is a `<details>`, so it
opens and closes with no script; `setUpExtra()` in `catalogue.mjs` closes it on
a click outside it and on Escape. Each hairline stands 16px from the words and
the marks beside it, because a line nearer to one neighbour reads as belonging
to it; `catalogue.css` says how that adds up out of the bar's gap, a link's
padding, the nav's gap and the mark's box. The catalogue and every per-sample
page carry that bar the same to the character, bar the hrefs — a reader who
opens a sample must not see the head change under them — so the per-sample
pages wire their menu and their switch with an inline copy of the catalogue's
handlers (`MENU_SCRIPT` in `tools/sample-pages.mjs`, kept in step with
`setUpExtra()` and `setUpTheme()` by hand, as the site memory is). The
playground's own bar (`src/shell/index.html`, `src/shell/shell.css`) carries
the same group after its toolbar — *Playground* as the current item, a span
rather than a link, because it is the page you are on and a stray click on it
would throw away a page that costs seconds to load, and the brand a span for
the same reason — with `extra.mjs` closing its menu; the documentation site's
bar (`theme/SiteBar.vue` over there) is the fourth copy. Three
documents here carry the two marks and the menu by hand
(`src/shell/index.html`, `src/catalogue/index.html`,
`tools/sample-pages.mjs`): inline SVG, because a mark that is an empty square
until a stylesheet arrives is worse than one that never needed it, and a
shared partial would be a build step in front of a page whose whole point is
that it is a file. `tests/shell.spec.js` and `tests/catalogue.spec.js` hold
each bar to the other's ends.

### A page per sample — `tools/sample-pages.mjs`, at `/samples/<class>/`

The catalogue is one URL with 770 samples drawn into it by JavaScript. That is
right for somebody searching and useless for somebody searching **the web**:
there is no address for "the abap2UI5 port of `sap.m.Wizard`", so there is
nothing a search engine can return. The three repository pages it replaced were
the same shape — a masthead and an empty `<section id="results">` — so nothing
was lost in the move; nothing was ever there.

So every entry in the index also gets a **static page**: title, the demo kit's
own sentence, the class, the facts as a `<dl>` — which is also where the links
out live: the class on GitHub, SAP's own sample *running in the demo kit* for a
port of one (`sdk.openui5.org/entity/<entity>/sample/<sample>`, which needs the
entity too: seventy ports are filed under an entity in another namespace), the
documentation —, every control the class BUILDS (the linter's answer, each one
a link into the catalogue's control facet), its libraries, what it needs where
it cannot run, **the sample running**, **the class itself**, the neighbours
around it in its group, and back to the search. Real text in the HTML, and
nothing a crawler has to run to see any of it: the scripts on a page are the
two-line theme read the other two documents also carry, the bar's menu and
its switch and the site memory as inline copies of what the bundles import, and the demo
loader below, and none of them writes a word of it. `sample.css` is written beside them and
loaded next to `catalogue.css`, which is the frame: these are the catalogue's
pages, and a second palette would drift from it on the first change to either.

**And the sample runs on it.** Above the class is a demo box: press it and
`src/embed/abap2ui5-embed.js` — the same loader any documentation page embeds,
so these pages are the first reader of the kit this site ships — mounts the
playground in an iframe, in the page, on this sample's `raw` URL. Nothing loads
until it is pressed, which is that loader's own rule and the only one that
scales: a playground is a whole ABAP runtime plus an abaplint parse of nine
hundred sources, and 770 pages that booted one on sight would be 770 pages
nobody waits for. Only samples that `run` here get a box — a start button that
could only ever fail is not an offer — and the box carries *Switch to
Playground with this code* for a reader who wants the whole window. It is also why the page
no longer opens with a row of buttons: Run runs it here now, and the two links
beside it were links in front of the answer.

What it mounts is `data-view="app"` at `data-height="420"`: **the app and
nothing else** — no editor, no toolbar, no status line — in a box smaller than
the one an editor beside it needed. A page that prints the whole class two
screens down does not need a second copy of it inside a frame, and a strip of
the playground's own furniture across the top of it is furniture rather than
answer. The editor is on the box, in *Switch to Playground with this code*,
which is where a reader who wants to change a line goes anyway. 420 is what the demo is
read at rather than a floor it grows from: an abap2UI5 app is a `Shell` around
a `Page` laid out at 100% of its box, so it never overflows one and the
loader's grow-on-overflow never fires (`src/embed/abap2ui5-embed.js` says why
at length).

**The ABAP is on the page, not behind a link.** The class *is* the sample, and
a page that described one and did not show it sent the reader to GitHub for the
answer and a search engine nothing but a description. `tools/sample-sources.mjs`
fetches it — **one tarball per ref** from codeload, so 770 classes cost about a
dozen requests instead of 770, cached on disk for a day and re-fetched by every
CI runner — and `tools/abap-highlight.mjs` colours it *here*, because these
pages carry no highlighter of their own: a scanner over comments, literals,
numbers and keywords, emitting the same token classes the bottom panel's own
highlighter does (`src/shell/highlight.mjs`), with every character escaped on
the way in.
Classes are printed whole up to **900 lines or 60 KB**, after which the page
says what it cut and links to the rest — the tail of samples-controls is table
data around a chain, and one of them is two megabytes. A class that could not
be fetched simply has no block, and its page is what it was before: a ref that
does not arrive costs its samples their code and never the build.

**And every line of it has an address.** `#L42` highlights a line and
`#L42-L58` a passage, which is the one thing a reader could do with the copy on
GitHub and not with the copy here — "look at line 40 to 55" is most of what one
person tells another about a sample. Each line is an element of its own
carrying that id, and the number beside it is a **CSS counter**, drawn by
`::before` from `sample.css`: the numbers are not in the text, so selecting the
block and copying it still gives ABAP that pastes, which is the whole reason
the class is printed here rather than linked. The gutter is `sticky` inside the
scroller, over an opaque background — an abap2UI5 view is a chain written wide,
and a number that has scrolled out of the box is a number nobody can read a
link off; the line carries the background and the number inherits it, so a
marked line is not a white column with a coloured line beside it.

**One line needs no script at all**: `:target` is the browser's own answer to
`#L42`, and it is what a page with its JavaScript blocked still does. The
script (`LINES_SCRIPT`, at the end of the body, only on a page that prints a
class) exists for what `:target` cannot answer — the RANGE, which is a fragment
no element has an id for —, for the shift-click that composes one, and for the
*Copy link* button beside the class. It takes the single-line case over as it
runs, by marking the block `live` so the stylesheet's rule stops matching: one
line highlighted by one mechanism, never two by two. The selection is written
to the address bar with `replaceState` rather than pushed — the address bar is
the share link, and a reader who presses Back after picking three lines wants
the page they came from, not the two selections before this one. A link into
what the 900-line cut left out says so, rather than highlighting nothing.

What it costs is markup: an id and a link per line roughly doubles the
transferred weight of a page — about 6 KB to 12 KB gzipped on a typical one,
17 to 28 KB on the largest, 4.8 MB to 9.3 MB over all 771. That is the price
of an address per line, and it is paid in static documents nobody waits for
rather than in the bundle somebody came to write ABAP in.

Four rules hold the set together:

- **`page` is stamped on the index entry by the writer**, which is why it runs
  before `apps.json` is written. Which entries get a page is its rule — a class
  name that is a class name, an `https` source URL — and the catalogue's cards
  link to what was actually written rather than repeating that rule and
  drifting from it.
- **External data, escaped.** Everything on these pages comes from three
  repositories' committed files: every value is escaped into the markup, every
  link is dropped unless it is `https`, and a class name that is not a plain
  ABAP name gets no directory. A path is not a thing to build out of somebody
  else's JSON — and the printed ABAP is the same rule at scale: the highlighter
  escapes every character before any of it goes near a template literal, so a
  repository can never decide what is a tag here.
- **Linked, not only listed.** A page in a sitemap and in no link is a page a
  crawler may ignore. Every card's title links to its page, each page links to
  its neighbours, and the catalogue's *footer* — its static half, the part that
  needs no JavaScript — links to `samples/all/`, which names all 770.
- **No `robots.txt`.** This site is a project page under
  `abap2ui5.github.io/playground/`, and a crawler only reads `/robots.txt` at
  the domain root, which belongs to another repository. `sitemap.xml` is
  discovered by being submitted, or not at all; the links above are what
  actually does the work.

`SITE` (overridable with `PG_SITE_URL`) is the one absolute URL on this site,
and only these pages need it — a canonical link and a sitemap are absolute by
definition, everything else stays relative so the site still works under any
path. The pages are **not** in the service worker's allow list: they are static
documents nobody revisits offline, and 770 of them in a cache is not what
somebody who came to write ABAP asked for. `tests/sample-pages.spec.js` runs
against the real index, because a fixture would test a page that was never
written.

The service worker keeps the page and its index **on use, not in the precache**
(`src/shell/sw.js`): `apps.json` alone is most of a megabyte, and somebody who
came to write ABAP must not download 770 samples to do it. Caching it is right
where caching the old fetched-at-runtime catalogues would have been wrong — it
is written by the deploy that wrote the bundle beside it, so it is exactly as
current as the build.

## Build, run, test

```sh
npm ci
npm run build     # deps -> framework -> UI5 -> site; first run takes minutes
npm run serve     # dist/ on http://localhost:8080, also mounted under a subpath
npm test          # Playwright, chromium, against the built dist/
npm run check     # the three above as one command - what check.yml runs
```

`npm test` on its own runs against whatever `dist/` already holds, so on a fresh
clone it fails as a 30-second `webServer` timeout rather than as "nothing is
built" — `npm run check` is the entry point that cannot be typed in the wrong
order. It leaves out exactly one thing `check.yml` does: `npx playwright install
chromium`, a browser download rather than a step, which `npm test` then asks for
by name (CONVENTIONS section 3 asks for that omission to be named here).

The tests are the gate: everything runs through a real browser, and
`tests/samples.spec.js` imports the sample catalogue and drives every entry —
a sample without a test is not possible. CI:

| | |
|---|---|
| `check.yml` | every non-main branch and pull request: the composite build action (`.github/actions/build`, with caches for `deps/`, `~/.ui5` and the downport), the size budget, `npm test` |
| `pages.yml` | pushes to `main`: the same build and tests, then deploy `dist/` to GitHub Pages — a red test never publishes |
| `upstream.yml` | weekly: build and test against upstream `HEAD` without moving the pins, and open or extend an issue when that fails, so a bump stays a two-line commit |

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
  *one* statement of up to 1600 tokens joined with `&&`. Those 124 classes took
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

## One site in three places

The playground, the sample catalogue at `/samples/` and the
[documentation](https://abap2ui5.github.io/docs/) are three deployments on
**one origin**, and they are meant to be read as one site: the same bar, the
same palette, the same measure. The documentation lives in
[abap2UI5/docs](https://github.com/abap2UI5/docs), which carries its half of
each mechanism below.

**What the bar carries, left to right.** The mark and the name, then the four
sections of the project — **Home**, **Documentation**, **Samples**,
**Playground** — then the search box, then the two marks and the menu behind
the last button. Home and Documentation are two pages of the documentation's
deployment; Samples and Playground are here.

**This repository's own bar is the exception, in one respect only.** On the
catalogue and the per-sample pages the sections stand against the brand and the
search is centred, exactly as over there. The playground's own bar cannot do
that: it is a workbench — undo, format, Samples, Run, Auto, Share, Full screen
— and that toolbar owns the middle and the space after the mark. So there the
group (search, four sections, marks, menu) keeps the right-hand end it has
always had, in the same order and drawn with the same values. Everything about
the group itself is identical; only where the row puts it is not.

**The bar exists four times, by hand** — `src/shell/index.html`,
`src/catalogue/index.html`, `tools/sample-pages.mjs` and, over there,
`theme/SiteBar.vue` with `theme/style.css` — and so does the menu behind its
last button: the switch, the practical links (issues, release notes, install,
support, contribute, sponsor), the tools, then the repositories by kind in two
columns. So does the palette
(`src/shell/shell.css` is the original; `catalogue.css` says it is a copy and
why). A shared partial would be a build step in front of a page whose whole
point is that it is a file, and a shared stylesheet across two repositories
that deploy separately would be a request in front of the first paint. Change
them together.

**The search box is not a fourth copy, and its index is not a copy at all.**
The box is `src/shell/search-box.mjs` — plain DOM, because two of the three
documents here have no framework and one of them is written 772 times by a
build script. The playground's bundle imports it; the catalogue and every
per-sample page load it as `dist/samples/search.mjs`, one module for all 773
documents, bundled from `src/catalogue/search-entry.mjs` and budgeted in
`tools/check-size.mjs`. `src/shell/search-engine.mjs` (the matching) IS a copy
— of `docs/.vitepress/theme/search-engine.js` over there, kept in step by hand
like the palette.

What it searches is one generated document, `/docs/search-index.json`: every
page of the documentation, and every entry of the three sample catalogues. The
documentation builds it (`scripts/generate-search.mjs` over there) and all four
bars fetch it from the shared origin, lazily, on the first keystroke. Two
copies of that data would be two answers to one query, which is why this one
thing is fetched rather than copied.

**The catalogue keeps its own search field, and that is not a duplicate.** That
field is a FILTER: it narrows the 770 rows in front of you, works with the
three facets beside it, and writes a URL that can be shared. The box in the bar
answers a different question — "where is X in this project" — from any of the
four bars, and leaves the page to answer it.

**One origin means one localStorage**, which two things rely on:

| | |
|---|---|
| the theme | `abap2ui5-playground:theme`, read before the first paint by the inline script at the top of all three documents here and by a head script over there. The switch in any of the four bars turns all four |
| where you were | `src/shell/site-memory.mjs`, imported by the shell and the catalogue bundles and carried as an inline copy by the per-sample pages, which have no bundle. Every samples page writes its own path down — the catalogue's *with its filters*, because the filters are the page there — and the Samples item on the other bars is lifted to it: at boot, again when the page is shown or the tab looked at again, and on the click itself (`keepSiteLinksCurrent()`), because a link lifted once and left open carries the position from before. A stored value is **checked, not followed**: resolved against this origin and kept only if it is still inside the href the markup carries, so a poisoned or stale key costs a restored position and nothing else. All three items open in the same tab — the sites are one site, and a bar that opened one of them in a second window was the one asymmetry between the four bars |

The playground is consulted by both and remembered by neither: its URL carries
the code in the editor, so an item that reopened yesterday's sample would be a
different promise from the one the word makes.

`tests/site-memory.spec.js` holds the round trip and the values that must be
refused. The documentation half cannot be reached from here — it is another
host in a test run — and is a unit test over there
(`test/site-memory.test.mjs`) with a stubbed `location`.

## Deliberate limits — do not "fix" these

- **The first file is the app.** Positional on purpose; a required class name
  would force every deep link to rename what it points at. A test include
  cannot be first for the same reason: it declares no app.
- **Only what the transpiler implements.** Anything it cannot compile is
  reported in the panel; there is no fallback and none is wanted.
- **Only the UI5 libraries in `UI5_LIBRARIES`** (`src/shell/ui5-libraries.mjs`,
  built by `tools/build-ui5.mjs`). A control from any other library will not
  load; SAPUI5-only libraries (`sap.ui.comp`, `sap.suite.*`, …) cannot be
  added to an OpenUI5 build at all.
- **No IndexedDB persistence for the drafts database** — considered and
  refused (PLAYGROUND_PLAN.md, phase 8): restored rows would be orphaned data,
  or would revive an instance of an old shape of the class. "Run starts fresh"
  is the promise.
- **The corpus ships whole — method bodies and all, for everything the editor
  can be asked about.** The one exception is abap2UI5's generated frontend
  (`src/01/03`), which is not ABAP anybody reads and is left out for the stack
  rather than for the bytes — the third trap above. For the rest: it is the
  largest single thing the editor waits on and the obvious place to look for a
  saving, so here is the measurement, to save the next person from running it
  again.
  Replacing every `METHOD … ENDMETHOD` with an empty one takes
  `corpus.json` from 0.60 MB compressed to 0.21 MB and roughly halves the
  parse. (Measured before the generated frontend came out of it, which took the
  same file to 0.43 MB on its own; the shape of the argument is unchanged.)
  But of the 3.8 MB of ABAP in it, 2.9 MB is abap2UI5 itself and only
  0.8 MB is open-abap — so stripping only the standard library, where nobody
  ever reads an implementation, saves 0.05 MB and is not worth having. The
  saving is only there if the abap2UI5 sources go too, and those are exactly
  what somebody control-clicks into to find out how the framework does
  something. Reading the framework is the playground; a tenth of the download
  does not buy it.
- **The generated frontend is a stub in the framework bundle.** The 62
  `z2ui5_cl_ui5f_*` classes are registered by name and throw a sentence from
  `get()`; only the http handler's GET branch reads them, and the playground
  never GETs — the frame's document comes from `dist/app`. Wiring that branch
  up would mean carrying 1.7 MB of frontend text a second time for nothing
  on screen.
- **The `?src=` host allow list stays short.** The playground fetches on
  behalf of whoever opened the link and must not become a general-purpose
  reader for arbitrary URLs.

## Toolchain

Node 22, matching the rest of the organisation — `engines.node` is `>=22` and
`.nvmrc` says `22`, as CONVENTIONS section 4 requires. Both were missing until
2026-08-28: this paragraph asserted the version and nothing declared it, so
`nvm use` picked whatever the shell had. Every npm dependency is pinned
exactly — the transpiler, abaplint and the linter end up inside the bundle a
visitor downloads, so "whatever resolves today" would change the site under its
own tests. Actions are pinned to commits; `.github/dependabot.yml` moves npm
packages and action pins monthly, majors separated. The abap2UI5 linter does
not wait for that pass: `bump-linter.yaml` pins it to the latest release
weekly behind the full build-and-test gate, because a 0.x minor is a "major"
to Dependabot and the pin once sat four minors behind that way — an editor
blessing sources every other repository's CI would reject. The build itself
refuses a linter whose UI5 metadata snapshot disagrees with `UI5_VERSION`
(`tools/build-ui5.mjs`), so that drift surfaces in the bump PR, not on main.
The git-source pins move the same way: `bump-sources.yaml` runs
`tools/fetch-deps.mjs --update-pins` weekly - the three runtime pins together
(the frontend leads, its `result/cloud/VERSION` names the framework commit, the
framework names open-abap-core) and the samples pin to its own HEAD beside them
- behind the same full gate, so the last freshness work done by hand is gone
too. That gate is also what turns a sample renamed upstream into a red bump PR
rather than a page that opens on nothing.
