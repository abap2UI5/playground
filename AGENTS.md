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
| `src/shell/` | The page: boot and Run (`main.mjs`), layout and splitter, toolbar, share links (`share.mjs`; the Share dialog in `share-dialog.mjs`, with the embed block, the markdown fence and the abapGit zip that `export.mjs` lays out and `zip.mjs` writes - stored entries, by hand, forty lines rather than a dependency), `?src=` deep links (`deep-link.mjs`), the examples browser over the sample repositories' catalogues (`examples.mjs`, filtering by the closed library list in `ui5-libraries.mjs`), the bottom panel (`insight.mjs`), embed messaging (`embed.mjs`), light or dark (`theme.mjs` — the switch at the bar's right-hand end, applied as `data-theme` on `<html>` and handed to the editor and the app frame), every `localStorage` touch (`storage.mjs` — bar one, the inline script at the top of `index.html` reading the stored theme before the first paint) and what is kept in it between visits (`checker-settings.mjs`), the page's handle on the ABAP runtime worker (`runtime-client.mjs`), the warm-up of the app frame's first load (`warm-up.mjs`) and the favicon (`favicon.png`, `apple-touch-icon.png` — the docs' mark, rendered down) — `frontend-bridge.js`, the fetch interception injected into the app frame, and `sw.js`, the service worker that makes a second visit cheap |
| `src/editor/` | Monaco plus the abaplint registry — in a worker: `registry-core.mjs` and `transpile-core.mjs` are abaplint and the single-object transpile as they run there, `registry-worker.mjs` the worker's entry, `registry.mjs` the page's client with a promise in front of everything, `providers.mjs` Monaco's language providers answered over it — the abap2UI5 linter wrapper (`abap2ui5-lint.mjs`), the file set and the sample catalogue (`samples.mjs`) |
| `src/runtime/` | The ABAP side of the page: the framework entry (`index.mjs`, `roundtrip()` and `defineClasses()`), `worker.mjs` around it, which is the bundle's entry and answers those over `postMessage` when it runs as the worker the page starts, the sql.js database (`db-setup.mjs`), and the browser shims for Node modules |
| `src/abap/` | The playground's own ABAP (`zcl_pg_bridge`, `zcl_pg_hello`); it travels through the same downport and transpile as the framework |
| `src/examples/` | ABAP served as static files, so `?src=` has same-origin targets and the link tests depend on no foreign host |
| `src/embed/` | The embed loader (`abap2ui5-embed.js`) and a worked example page; copied verbatim to `dist/embed/` |
| `tools/` | The build (`build.mjs`, which drives `fetch-deps`, `build-framework`, `build-ui5`, `build-site`), the size budget (`check-size`) and the dev server (`serve`) |
| `tests/` | Playwright specs — the only test layer; everything is tested through a real browser against the built `dist/` |

`deps/`, `build/` and `dist/` are generated and gitignored. Never commit them.

## The build pipeline

`npm run build` is `tools/build.mjs`, which runs four steps, each cached by a
hash of its inputs, so only the first build costs minutes. Steps 2 and 3 run
**together** — they read different sources and write to different places, and
only step 4 reads what either produced — so a cold build costs the longer of
them rather than both. Their output is streamed with the step's name in front
of each line. Each step is still its own script and still runnable by name
(`npm run build:framework`):

1. **`tools/fetch-deps.mjs`** pins `abap2UI5/abap2UI5` and `open-abap-core` by
   commit SHA under `deps/`. Bumping a pin is editing the sha there — nothing
   else fetches source.
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
4. **`tools/build-site.mjs`** bundles the page and, as a bundle of its own,
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
   has not gotten any smaller.

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
  mirrors what the frame loads first and may go stale harmlessly.
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
  it stops pushing the last control onto a row of its own. The three links at
  the far end go as well (the docs hide theirs on a phone too); the theme
  switch stays. Nothing else is *removed*: every control is still there and
  still reachable, which is what `tests/shell.spec.js` holds it to, along with
  the height.
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

The **theme** follows the middle rule too (`src/shell/theme.mjs`): the switch
at the bar's right-hand end — the documentation site's switch, beside the same
three marks, LinkedIn, GitHub and the docs — stores a choice only while it
differs from what the system says, so a page switched back follows the system
again, and an embedded playground never restores one.

The **draft** follows the middle rule for the same reason: a file set identical
to one of the built-in samples is forgotten rather than stored (`isSample()` in
`src/editor/samples.mjs`, applied in `remember()`). Reading a sample is not work
to continue, and storing it as a draft pinned that visitor to a frozen copy of
it — the sample was improved in a later deploy and they went on being opened on
the old one, findings and all, labelled "from your last session". One keystroke
makes it a draft again, and `tests/shell.spec.js` holds both halves.

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
- **`?view=app`**: hides the editor too, keeps the bar (a demo that cannot be
  restarted is a screenshot). **`?view=full`**: no bar either — what the Full
  screen button opens; the bar returns while the status line reports an error,
  because it is the only channel that mode has left.
- **The Samples button** (`src/shell/examples.mjs` — the ids and the module
  keep the older name): fetches the
  `catalogue.json` that **abap2UI5/samples** and **abap2UI5/samples-controls**
  commit at their roots (from `raw.githubusercontent.com` — a host `?src=`
  already trusts) and lists the entries next to the built-in samples, grouped
  by learning-path stage and by library, searchable — and **abap2UI5/samples-stack**'s,
  grouped by technology, whose samples all need a real system: listed and
  saying so, their rows disabled. Every row links to its file on GitHub —
  the repositories' own pages are gone, and this list is where a sample is
  looked up now. Beside the search are filters, kept between visits: the
  three repositories as one tinted group (Learn, Controls, Stack — on),
  "OpenUI5 only" (off; on, it drops the src/03 collection, a library only
  SAPUI5 carries, a stack sample that names SAPUI5) and "newer than 1.71"
  (on; off, it drops the controls repository's src/02). A chosen entry becomes the
  raw URL of its class and goes through the `?src=` loading path above — there
  is one loader, and this is a menu in front of it. The catalogue shapes
  (`samples[]` with `stage`, `ports[]` with `library`/`category`) are a
  contract with those repositories. Nothing is fetched before the button is
  clicked (a missing catalogue answers 404, and the browser logs that on its
  own — a page nobody asked for examples loads clean); the answer, hit or
  miss, is kept in localStorage for a day. No catalogue means the built-ins
  alone, silently. Two kinds of controls entries are listed but disabled,
  saying what they need: the SAPUI5-only `src/03` collection, and ports
  whose library is not in `UI5_LIBRARIES` — everything else is run and
  judged by the two checkers and Run, exactly like typed code; a catalogued
  sample the transpiler cannot compile fails visibly there, and that is the
  designed behaviour, not a bug.
- **`embed/abap2ui5-embed.js`**: turns an element into a click-to-load demo —
  `data-src` (one URL or several, first is the app), `data-code` (inline ABAP;
  the file is named after the class in it), `data-view`, `data-height`,
  `data-label`, `data-auto`. `window.abap2ui5Embed.setUp()` for pages that swap
  content without reloading. The frame posts `ready`, `status` and `height` to
  its parent. Click-to-load is deliberate: every demo boots its own runtime and
  parses the whole corpus.

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

## Deliberate limits — do not "fix" these

- **The first file is the app.** Positional on purpose; a required class name
  would force every deep link to rename what it points at.
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
`tools/fetch-deps.mjs --update-pins` weekly - the frontend leads, its
`result/cloud/VERSION` names the framework commit, the framework names
open-abap-core - behind the same full gate, so the last freshness work done
by hand is gone too.
