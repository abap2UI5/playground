# abap2UI5 browser playground — work plan

> **Historical.** This is the plan the playground was built from; for the
> current state read [README.md](../../README.md) and [AGENTS.md](../../AGENTS.md).
>
> **The Findings sections this text refers to "at the bottom" have moved** to
> [docs/design/build-traps.md](../design/build-traps.md), unchanged.

The goal: a playground as a static GitHub Page in this repository (abap2UI5/playground).
A Monaco editor with abaplint on the left (diagnostics, completion), the
running abap2UI5 app on the right. The ABAP is translated to JavaScript in the
browser by the abaplint transpiler and executed entirely client-side — no
server, no SAP system. The model was https://playground.abaplint.org/

**Status: phases 0–8 are all built.** The playground runs, 98 tests cover it,
CI is green.

> **This document is the plan that was followed, not a description of what
> exists.** (98 is what `npm test` reports; the source has 91 literal `test()`
> calls and `samples.spec.js` generates the rest from its sample list — count
> from the run, not from a grep.)
>
> It has been corrected where it had gone plainly wrong (the test count, the
> CDN, the configurable rules) but it is not maintained against the code. For
> what the playground *is*, read [README.md](../../README.md); the part of this file
> worth reading is the **Findings** sections, which record what each phase
> learned and still hold.

That makes this document two things: the work plan it was built from, **and**
the record of what it actually cost. The part that matters for the next
session is the **Findings** section at the bottom: every trap that ate half a
day, and why each solution looks the way it does. Anyone touching the build
reads it first.

For further work the original rule holds: take the topmost unticked checkbox
of the lowest open phase, satisfy its acceptance criteria, tick it here, and
commit the code and the plan update together.

---

## Working rules for AI sessions

- **Branch:** work happens on a branch and reaches `main` through a pull
  request. (This rule used to name one private branch and to say not to open a
  pull request; the history since is merged pull requests, #10–#14.)
- **One task per run of commits.** Finishing a task means: the code, a test or
  other evidence for the acceptance criteria, the checkbox in this document
  ticked, and where relevant the phase's "Findings" section extended.
- **Do not guess, go and read.** The reference implementation is the `node/`
  folder in the `abap2ui5/abap2ui5` repository (same session scope). The
  complete transpiler pipeline runs there in production:
  `node/setup/abap_transpile.json`, `node/setup/setup.mjs` (sql.js/SQLite
  bootstrap), `node/srv/express.mjs` + `node/srv/zcl_sicf.clas.abap` (the HTTP
  entry point), and the `package.json` scripts `downport` and `auto_transpile`
  (the downport recipe).
- **Pin versions.** Every abaplint package (`@abaplint/transpiler`,
  `@abaplint/runtime`, `@abaplint/database-sqlite`, `@abaplint/monaco`,
  `@abaplint/core`) and the abap2UI5 revision (commit SHA) are pinned exactly.
  Bumps are their own deliberate commits.
- **Write failures down.** When a task hits a hard obstacle (a runtime API
  turns out to be Node-only, say), that goes into the "Findings" section and
  the task is reformulated rather than quietly skipped.
- **Everything static.** The end result of every phase has to work with no
  server beyond GitHub Pages. No backend, no API keys, and — since P3.1 — no
  downloads at run time at all: the site carries its own OpenUI5 build, it does
  not link a CDN.

## The architecture being aimed at

```
GitHub Pages (static, from dist/)
│
├── index.html            playground shell: splitter, toolbar, file tabs
├── editor/corpus.json    the abap2UI5 and open-abap sources abaplint checks
│                         against, on the main thread (910 files)
├── runtime/
│   ├── framework.mjs     abap2UI5 + open-abap-core transpiled at build time,
│   │                     including the sql.js setup and the roundtrip() bridge
│   └── sql-wasm.wasm     SQLite as WebAssembly
├── app/                  the abap2UI5 UI5 frontend (webapp from build/cloud),
│                         running in an iframe, UI5 core built into the site
│                         (P3.1 — not a CDN link), with
│                         window.fetch for the backend URL redirected to the shim
└── examples/             ABAP as a static file, so `?src=` has something
                          to point at
```

The roundtrip at run time: editor → Run → transpile the user's classes against
the registry (on the main thread, ~20 ms) → execute with `new Function`, which
makes them register themselves in `abap.Classes` → clear the type caches →
reload the iframe → the UI5 frontend POSTs through `fetch()` → the bridge calls
the transpiled HTTP handler → JSON comes back → the app renders. State (drafts)
lives in sql.js, in memory.

Facts already verified (analysis of 2026-08-18):

- abap2UI5 is transpiled in full in CI and runs under Node
  (`npm run downport && npm run auto_transpile && npm run unit`).
- `@abaplint/database-sqlite` is built on sql.js (WASM) → works in a browser.
- The UI5 frontend talks to its backend exclusively through
  `fetch(url, {method: "POST"})` with a JSON body (`core/Server.js`) —
  stateless roundtrips, ideal to intercept.
- `@abaplint/monaco` exists and is maintained (Monaco being the VS Code
  editor); playground.abaplint.org is proof that transpiler, runtime and
  editor work in a browser.
- The backend's entry point: `z2ui5_cl_ui5_http_handler=>_main( is_req )` — a
  public class method over a plain structure, with no ICF needed (see the
  phase 2 findings).

---

## Phase 0 — repository scaffold and deployment skeleton

The goal: the repository can build and deploy to GitHub Pages before there is
anything of substance to deploy, so the deployment path is never the blocker.

- [x] **P0.1 npm scaffold.** `package.json` with pinned devDependencies
  (`@abaplint/cli`, `@abaplint/transpiler-cli`, `@abaplint/runtime`,
  `@abaplint/database-sqlite`, `@abaplint/monaco`, `monaco-editor`, and esbuild
  or vite as the bundler), a `.gitignore` (node_modules, dist, deps, output),
  and a "Playground" section in `README.md` with a short architecture summary
  and a link to this document.
  *Acceptance:* `npm ci && npm run build` completes locally (the build may at
  this point produce nothing but an empty `dist/index.html`).
- [x] **P0.2 Pages workflow.** A GitHub Action `.github/workflows/pages.yml`:
  on a push to the default branch run `npm ci && npm run build` and deploy
  `dist/` as the Pages artifact (actions/deploy-pages). Plus a `check.yml` that
  runs `npm run build` and, later, the tests on every branch.
  *Acceptance:* the workflow file is syntactically valid (actionlint or a
  `node -e` YAML parse); the build is green in the log of a branch run. (A
  human switches Pages on in the repository settings — noted in the README as
  a TODO for a human.)
- [x] **P0.3 Pinning script.** `tools/fetch-deps.mjs`, after the model of
  `abap2ui5/node/setup/fetch-deps.mjs`: pins the clones of
  `abap2ui5/abap2ui5`, `open-abap/open-abap-core` and
  `abapedia/steampunk-2305-api-intersect-702` by SHA under `deps/`
  (gitignored).
  *Acceptance:* running it twice is idempotent (a no-op the second time), and
  `--print-latest` shows the upstream HEADs.

## Phase 1 — the framework bundle: abap2UI5 transpiled for the browser

The goal: the whole framework plus open-abap-core exists as one static ESM
bundle that can be initialized in a browser. This is the port of `node/output`
+ `setup.mjs` to the browser.

- [x] **P1.1 Downport and transpile in the build.** A build script
  `tools/build-framework.mjs`: copies `deps/abap2ui5/src` to `build/downport/`,
  applies the downport recipe from abap2UI5's `package.json` (`abaplint --fix`
  with the 702 config, plus its `syfixes` / `strip_trailing_ws` replacements),
  writes a transpile config modelled on `node/setup/abap_transpile.json`
  (libs = the pinned deps, `write_unit_tests: false`, the same `skip` list
  where relevant) and calls `abap_transpile`.
  *Acceptance:* `build/output/` holds `init.mjs` and the `.clas.mjs` modules; a
  Node smoke test (`node -e "import('./build/output/init.mjs')"` with the
  sqlite setup from P1.2) throws nothing.
- [x] **P1.2 Browser setup for the database.** `src/runtime/db-setup.mjs`: an
  adaptation of `node/setup/setup.mjs` — load sql.js so that it works in a
  browser (copy the `sql-wasm.wasm` file into `dist/` and resolve it through
  `locateFile`), then run the schema and the inserts.
  *Acceptance:* a unit test (Node is enough, sql.js behaves identically) that
  runs `setup()` and then issues a SELECT against a z2ui5 table.
- [x] **P1.3 Bundling.** `npm run build:framework` bundles `build/output/*`
  plus the runtime and db-setup with esbuild into `dist/runtime/framework.mjs`
  (ESM, one file or a few chunks). Check for Node-only imports (`fs`, `path`,
  `child_process` must not end up in the bundle, or must be stubbed — esbuild's
  `platform: 'browser'` surfaces them).
  *Acceptance:* the bundle build is green; a headless browser test (Playwright;
  Chromium is preinstalled in the container at `/opt/pw-browsers/chromium`)
  loads a test page, calls `initializeABAP()` plus the DB setup, and reports
  success. Note the bundle size in the README.
- [x] **P1.4 Write the findings down.** Extend the "Phase 1 findings" section
  below: which modules had to be stubbed, how large the bundle is, how long
  `initializeABAP()` takes in a browser.

## Phase 2 — one roundtrip without a UI

The goal: a POST body of the shape the UI5 frontend sends goes in, the
framework's JSON answer comes out — entirely in the browser, still without
UI5. This was planned as the riskiest single component; it turned out to be
the simplest.

- [x] **P2.1 The bridge into the framework.** *(Reformulated against the
  original plan — see the phase 2 findings.)* Rather than reimplementing an
  `if_http_server`: `src/abap/zcl_pg_bridge.clas.abap` calls
  `z2ui5_cl_ui5_http_handler=>_main( )`, a public class method taking a simple
  structure in and returning one. `src/runtime/index.mjs` exports that as
  `roundtrip(body) -> {status, reason, body}`.
  *Acceptance:* a browser test against the built bundle.
- [x] **P2.2 The app-start roundtrip as a test.**
  `src/abap/zcl_pg_hello.clas.abap` as the built-in demo app. The wire format
  was read out of `app/webapp/core/Server.js`: the app-start body is
  `{"value":{"S_FRONT":{"SEARCH":"?app_start=<CLASS>"}}}` — the class name
  comes from the URL query, not from a field of its own.
  *Acceptance:* `tests/runtime.spec.js` — app start returns 200 with the view;
  a second roundtrip carrying the draft id fires an event and sees the state of
  the first (proving draft persistence through sql.js); an unknown app class
  produces a readable 500.
- [x] **P2.3 Session reset.** `resetDatabase()` in `src/runtime/db-setup.mjs`
  rebuilds the database.
  *Acceptance:* a test — roundtrip, reset, and the old draft id is unusable
  afterwards.

## Phase 3 — the UI5 frontend in an iframe: the first visible app

The goal: a real abap2UI5 app renders on the right, still with a hard-wired
example class (the editor arrives in phases 4 and 5).

- [x] **P3.1 Ship the frontend instead of using a CDN.** *(Reformulated — see
  the phase 3 findings.)* `tools/build-ui5.mjs` builds
  `deps/abap2ui5/build/cloud/app/webapp` with the UI5 tooling against a pinned
  OpenUI5 version; the libraries come from npm and land under
  `dist/app/resources/`. Instead of a CDN link.
  *Acceptance:* a test — starting the app makes not one request to a foreign
  origin, and nothing 404s.
- [x] **P3.2 fetch interception in the iframe.** `src/shell/frontend-bridge.js`
  runs as a classic script before the UI5 bootstrap, sets
  `z2ui5.checkLocal = true` (so the frontend POSTs to its own URL) and replaces
  `window.fetch` for exactly that one request; everything else goes to the
  network untouched.
  *Acceptance:* a test — the app renders visibly, a click on the button fires a
  roundtrip, and the text computed in ABAP appears.
- [x] **P3.3 The reload cycle.** `run(appClass)` in `src/shell/main.mjs`: a new
  database, then reload the iframe with
  `app/index.html?app_start=<CLASS>&run=<n>`. The counter makes every run its
  own document, so the browser cannot serve a cached one.
  *Acceptance:* a test — change some state, press Run, and the app is back at
  the beginning.

## Phase 4 — the editor: Monaco plus abaplint

The goal: an editor on the left that feels like VS Code — live diagnostics,
hover, go to definition, rename, pretty printer — against the real framework
definitions.

- [x] **P4.1 Embed Monaco.** `src/editor/editor.mjs`: Monaco from npm, the ABAP
  grammar from `monaco-editor/languages/definitions/abap`, the theme following
  `prefers-color-scheme`. Monaco's own workers are deliberately not built (see
  the findings).
  *Acceptance:* a test — the editor renders the example code with highlighting.
- [x] **P4.2 The abaplint registry.** *(No web worker — see the findings.)*
  `src/editor/registry.mjs` builds a registry with the **original** sources of
  abap2UI5 and open-abap-core as dependencies (`dist/editor/corpus.json`, 910
  files, 3.8 MB) plus the user's file. Syntax target v750, the rule set limited
  to "would this work". The first parse goes through `parseAsync` with progress
  so the page does not freeze.
  *Acceptance:* tests — a syntax error produces a marker on the right line; a
  class that accesses the framework correctly reports **nothing** (proving the
  registry knows the framework); a class name that does not exist and a missing
  method implementation are both reported.
- [x] **P4.3 Wire up @abaplint/monaco.** Diagnostics as markers, hover,
  definition, rename, references, symbols, quick fixes, semantic highlighting
  and the pretty printer through `registerABAP( )`. Name completion is
  **written here** — abaplint has no API for it (see the findings).
  *Acceptance:* tests — completion offers `z2ui5_cl_ui5_view_builder`, hover
  shows something, Format re-indents the class.

## Phase 5 — live transpile: the actual core of the playground

The goal: the code in the editor runs as the app on the right after Run.

- [x] **P5.1 Downport the user's class.** **Dropped entirely** — the transpiler
  understands modern ABAP directly (see the phase 5 findings).
  *Acceptance:* the test "modern ABAP is compiled without a downport step" —
  `VALUE #( FOR … )`, `COND #`, string templates, inline declarations and table
  expressions all run as an app.
- [x] **P5.2 Single-object transpile.** `src/editor/transpile.mjs`: the
  transpiler is handed a proxy onto the registry in which only the user's class
  exists. 20 s → **10–50 ms**.
  *Acceptance:* a test — change the editor, Run, the new app renders.
- [x] **P5.3 Load and register.** `defineClass( )` in `src/runtime/index.mjs`
  executes the generated code with `new Function` (not a blob import — that
  would be cached) and then clears the framework's type caches.
  *Acceptance:* the test "a second run replaces the class" — a second run with
  different attributes renders correctly.
- [x] **P5.4 Error UX.** Run is blocked on errors and names the line; a
  misnamed class gets a message of its own rather than abaplint's "must match
  filename"; an ABAP exception lands in the framework's error screen with the
  full dump.
  *Acceptance:* three tests, one per error screen.

## Phase 6 — playground UX

The goal: the technology demo becomes a playground somebody can link to.

- [x] **P6.1 Shell layout.** A draggable splitter (its position remembered,
  operable with the arrow keys), a toolbar with Run (Ctrl+Enter), Format, the
  sample picker and Share, and a status line with the framework version. Below
  820 px the two panes become tabs.
  *Acceptance:* tests — the splitter moves and survives a reload; a narrow
  window shows tabs; back at desk width both panes are visible again.
- [x] **P6.2 Sample gallery.** Six examples in `src/editor/samples.mjs`: hello
  world, a counter, a table with multiple selection, a form with validation,
  tabs with a list, and a confirmation popup over `nav_app_call`.
  *Acceptance:* `tests/samples.spec.js` drives **every** sample: load it, run
  it, operate it and check the result computed in ABAP. The list is imported
  from the catalogue — a sample without a test is not possible.
- [x] **P6.3 Share links.** `src/shell/share.mjs`: the source deflated and
  base64url-encoded in the URL fragment (with a version prefix). Share copies
  the link to the clipboard and writes it into the address bar.
  *Acceptance:* a test — build a link, open it in a fresh browser context, and
  the same code is in the editor; a broken fragment opens the sample rather
  than an error page.
- [x] **P6.4 Persistence.** The editor content in `localStorage`; at startup a
  share link beats the stored draft beats the sample. The sample menu says
  where the code came from instead of claiming a name.
  *Acceptance:* a test — the content survives a reload, and picking a sample
  replaces it.

## Phase 7 — quality, CI, documentation

- [x] **P7.1 CI gates.** `.github/actions/build` (a composite action shared by
  `check.yml` and `pages.yml`) installs, restores the expensive intermediates
  from cache (`deps/`, `~/.ui5`, `build/downport`), builds and checks the size
  budget (`tools/check-size.mjs`). The tests run after that. Pages deploys only
  once the tests are green.
  *Acceptance:* a green run on GitHub (~5 min); `npm run check:size` runs
  locally.
- [x] **P7.2 A version-bump process.** Documented in the README. Plus
  `.github/workflows/upstream.yml`: builds and tests **weekly against upstream
  HEAD** without touching the pins, and opens an issue when that fails (or
  comments on the existing one). `tools/fetch-deps.mjs --latest` is the switch
  for it.
- [x] **P7.3 Documentation.** A README with a screenshot, an architecture
  diagram, "how it works", **what it cannot do** (one class, no database of
  your own, only the transpiler's language coverage, only the UI5 libraries
  built in) and a map of the build scripts. This plan stays the detailed
  reasoning and is linked from the README.
- [x] **P7.4 Ready to announce.** Checked against the original idea: an editor
  with abaplint on the left ✓, the app on the right ✓, everything in the
  browser ✓, as a GitHub Page ✓. The only remaining action for a human:
  Settings → Pages → Source → "GitHub Actions".

## Phase 8 — further stages

- [x] **Multi-file support.** The playground now holds several ABAP files,
  named as abapGit names them (`zcl_detail.clas.abap`, `zif_thing.intf.abap`),
  with file tabs above the editor. **The first file is the app** — that
  replaces the earlier rule that the class had to be called ZCL_PLAYGROUND.
  *Acceptance:* `tests/files.spec.js` (8 tests) plus the new "Two apps" sample,
  which shows `nav_app_call` between two of your own classes.
- [x] **Deep links.** `?src=<url>` opens ABAP that lives elsewhere; several
  `src` parameters open several files. Allowed sources are this origin and
  GitHub's raw hosts — the playground fetches on behalf of whoever opened the
  link and should not be an open read proxy.
  *Acceptance:* `tests/link.spec.js` against example files shipped under
  `dist/examples/` (same origin, so the test does not depend on a foreign host
  being up).
- [x] **Embedding mode.** `?embed=1` hides the brand, the sample menu, Share
  and the version line, and leaves the editor, Run and the app. An embedded
  playground also does **not** write to the draft store — it shows what the
  embedding page asked for, and does not overwrite the reader's work.
  *Acceptance:* two tests, one of them precisely for the not-overwriting.

- [ ] **IndexedDB persistence for the sql.js database — deliberately not
  built.** Thinking it through, the idea does not hold up: the database holds
  *drafts*, that is serialized instances of the app, addressed by ids the
  frontend holds as well. After a reload the frontend starts without a draft
  id, so the restored rows would be orphaned data rather than restored state.
  To really continue, one would have to store the draft id too — and then an
  instance of the *old* shape of the class would be revived, exactly the class
  of stale-state bug that caused the `BINDING_ERROR` in phase 5. "Run starts
  fresh" is the more dependable promise.
- [x] **Configurable abaplint rules in the UI — built after all.** This item
  argued against it: 188 rules as a wall of switches helps nobody, the rules
  that really matter for abap2UI5 (chain layout, view-display-on-navigated) are
  the abap2UI5 linter's rather than abaplint's, and a "strict" switch carrying
  keyword case and indentation would be a button that needs explaining.

  What was built instead answers the objection rather than ignoring it: the
  Insight panel's **abaplint** and **abap2UI5 lint** tabs hold the live
  configuration as JSON, not as a wall of switches, so the default stays the
  short curated list and anyone who wants one of the other rules can add it and
  see the effect immediately (`src/shell/insight.mjs`). The README documents it.
  Left here with its original reasoning visible, because the reasoning is why
  the feature has the shape it has.

---

---

The **Findings** that followed this plan are in [docs/design/build-traps.md](../design/build-traps.md).
