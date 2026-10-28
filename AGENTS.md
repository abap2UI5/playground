# AGENTS.md

The abap2UI5 browser playground: a static page, published to GitHub Pages, with
Monaco and abaplint on the left and a real abap2UI5 app on the right. The ABAP
in the editor is transpiled to JavaScript in the browser and run against the
actual framework — transpiled at build time from a pinned commit — with nothing
behind it: no server, no SAP system, no backend of any kind. Beside it, on the
same origin: the sample catalogue at `/samples/` with a static page per
sample, the AI Studio (`/ai/`), the AI Pilot (`/pilot/`), and the embed kit
that documentation pages use.

**This file is the short version.** The reasoning behind every rule — the
measurements, what was tried and refused — is in `docs/design/<area>.md`;
read the one for the area you touch (index at the end).
[README.md](README.md) is the user-facing description.
[build-traps.md](docs/design/build-traps.md) holds the still-valid Findings
of the original plan ([docs/history/](docs/history/PLAYGROUND_PLAN.md)) —
read them before touching `tools/` or `src/runtime/`.

## Layout

`deps/`, `build/` and `dist/` are generated and gitignored. Never commit them.

### `src/shell/` — the page

| Module | Purpose |
| --- | --- |
| `main.mjs` | Boot and the bar: `boot()` caught as a whole, `remember()` (draft, studio build), `showSourceLink()`, Share/Full screen |
| `page.mjs` | Which page this is: `params`, `embedded`, `aiPage`, `pilotPage`, `appOnly`, `keepsDrafts`, `frameIsolated`, the catalogue query, the frame |
| `starting-files.mjs` | `startingFiles()`: link, draft or sample; a failed link or a declined Pilot link with its files |
| `run.mjs` | Run: compile, define, test, start; frame load and restart in place, `runWhenFree`/`withRunLock`, `pointAtDump`, `structuralProblem`, frame theme |
| `run-status.mjs` | The status line between runs ("running - the code on screen has N errors"), transient words, the stale-frame mark |
| `autorun.mjs` | Auto (debounce, stored setting) and Run's three reasons to be inactive |
| `file-sets.mjs` | `replaceWith()`, `keepDraft()`, opening a sample/draft/linked class, the kept-draft sentence; `openedFiles()`, `isAsOpened()`, `onOpenedChange()` |
| `agent-hooks.mjs` | `offerFrameBridge()` (the frames' roundtrips), the AI Studio's and Pilot's hosts, `runForAgent()`, `addAppFiles()` |
| `site-cache.mjs` | `keepAssetsForNextTime()` (registers `sw.js`), `discardCachedSite()` |
| `frame-link.mjs` | The page's half of the frame line, messages only: `isolate()`, `navigate()`, `serveFrames()`, `tellFrames()`, `frameApi()`, `linkOf()`, `onFrameMessage()` |
| `guides.mjs`, `first-steps.mjs`, `learn-path.mjs` | The first-visit hint strip and "Lesson n of m" (chunks after the first run), and the module that decides on them |
| `original.mjs`, `compare-dialog.mjs` | Compare (± Monaco diff dialog, chunk) and Reset (⟲) against the original; `unchangedRawUrl()` |
| `layout-editor.mjs` | The Share dialog's "Open in Layout Editor" (`?src=` or clipboard + `#playground=`) |
| `ui5-floor.mjs` | The bar's UI5 select: the linter's `ui5` floor, kept in step with the lint tab |
| `index.html` | The document; its inline script starts both workers, the wasm fetch and Monaco's preloads before the bundle arrives |
| `shell.css` | The page's styles and the palette's original (`catalogue.css` copies it) |
| `layout.mjs` | Splitter at desk width, ABAP/App tabs below 820px |
| `ui.mjs` | Status line and the Log text; `describeError()` |
| `state.mjs` | The two fields the page knows beyond the editor and DOM (runtime handle, …) |
| `storage.mjs` | Every `localStorage` touch (access may throw) |
| `persistence.mjs` | The draft and the file on screen between visits |
| `drafts.mjs` | Named drafts (fifty at most), listed in the samples dialog |
| `checker-settings.mjs` | What the two Config tabs were last set to |
| `theme.mjs` | The playground's light/dark switch, handed to editor and frame |
| `theme-boot.mjs` | `THEME_BOOT`/`THEME_MENU`: the inline theme scripts every document carries (the one `localStorage` touch outside `storage.mjs`) |
| `extra.mjs` | Closes the bar's menu on outside click and Escape |
| `files-ui.mjs` | The file strip: `+`, `+ table`, naming a file in place |
| `share.mjs` | Share links: files in the fragment, deflate-raw + base64url |
| `share-dialog.mjs`, `export.mjs`, `zip.mjs` | The Share dialog (link, embed block, markdown fence, Gist), the abapGit package layout (tables in `src/`, rows in `data/`), a stored zip written by hand |
| `gist.mjs` | `?gist=<id>` read, a gist written |
| `deep-link.mjs` | `?src=`: the host allow list, `rawFor()`, siblings |
| `linked-code.mjs` | What is asked because a link's code runs here (`markLinkedCodeRan()`, the Pilot's `#linked-dialog`) |
| `embed.mjs` | Messages to an embedding page (`ready`, `status`, `height`, `edited`; `reset` in); `?readonly=`, `?lines=` |
| `examples.mjs` | The samples dialog over `samples/apps.json` |
| `sample-marks.mjs` | The `(A)`/`(C)` marker legend (dialog, catalogue, sample pages) |
| `catalogue-urls.mjs` | Raw and GitHub URLs of a catalogued sample from `file`/`branch` |
| `ui5-libs.mjs` | Which UI5 library a control ships in; `cmpVersion` |
| `ui5-libraries.mjs` | `UI5_VERSION`, and `UI5_LIBRARIES`, the closed set this site carries |
| `search-box.mjs` | The bar's search box (all documents here) |
| `search-engine.mjs` | Its matcher — a copy of abap2UI5/docs' `search-engine.js`, plus `normalise` |
| `search-terms.mjs` | The dialog's and catalogue's free-text filter (`foldCase`, `queryTerms`) |
| `site-memory.mjs` | Where the reader was on each neighbouring site; `returnTo()` |
| `runtime-client.mjs` | The page's handle on the runtime worker (HEAD probe, STALLED) |
| `warm-up.mjs` | The app frame's first load, fetched into the HTTP cache during the parse |
| `frontend-bridge.js` | Injected into the app frame, talks to the page by `postMessage` only: the fetch interception, restart in place, the AI calls, storage shims for an opaque frame |
| `sw.js` | The service worker (build id, hashes and chunks substituted by the build; `verifiedHit()`) |
| `roundtrips.mjs` | The recorded roundtrips (bounded at 200, cleared per Run) |
| `insight.mjs` | The bottom panel: strip, folding, drag, redraw, empty-tab shrink |
| `insight-common.mjs` | What a tab may ask of the panel (`empty()`, `blockHead()`, …) |
| `insight-<tab>.mjs` | One module per tab: `problems` (+ Fix them bar, `fixableSaid()`), `outline`, `view` (`viewTab()`), `tests` (`testsTab()`), `roundtrips` (`roundtripsTab()`), `state` (app attributes per roundtrip), `console` (WRITE output, `#console-count`), `log`, `config` (the two checkers' tabs) |
| `highlight.mjs`, `xml-pretty.mjs` | Colour for the panel's XML/JSON; XML one element per line |
| `chain-read.mjs`, `view-edit.mjs`, `chain-patch.mjs`, `chain-write.mjs` | View edit: chain read back by executing it; edited view matched to the shown one; change patched into the ABAP that is there; fallback rewrite in the house layout |
| `chat.mjs` | AI Studio on screen (chunk, its page only) |
| `ai-agent.mjs` | AI Studio's conversation and tools (`runTools()`), chunk on use |
| `ai-starter.mjs` | The class the studio starts on |
| `target-system.mjs` | The studio's target system: `TARGETS` (abaplint releases the header offers, the rules the model is told), `systemTodos()` (the `" TODO(system):` lines the download lists), `functionCalls()`/`uncheckedCallsText()` (every CALL FUNCTION - nothing else here reports one) |
| `pilot.mjs` | AI Pilot on screen and the bridge's half (chunk) |
| `pilot-agent.mjs` | AI Pilot's conversation, mirror and tools (chunk) |
| `ai-operator.mjs` | The mirror and operator both rooms use on a frame |
| `frame-drive.mjs` | One app frame as the AI's transport |
| `chat-ui.mjs` | What both chats share on screen (`createChatRoom()`: log, key form, Send/Stop, speed, files, one submit) |
| `markdown.mjs` | `renderMarkdown()`, `streamMarkdown()` (incremental) |
| `ai-speeds.mjs` | `SPEEDS` and `DEFAULT_SPEED` - the one list both headers' selects are written from |
| `ai-common.mjs` | Prices, errors, `runTurnLoop()`, `followStream()`, `str/clip/echo/count`, `rankEntries()` |
| `llm-provider.mjs` | Anthropic SDK or an OpenAI-compatible server; `httpUrl()`, `keyHost()` |
| `llm-form.mjs` | The provider half of both key forms; `keyTarget()` |
| `attach-ui.mjs` | Files for a message on screen (paperclip, chips, paste, drop) |
| `attachments.mjs` | Files turned into Messages API blocks (xlsx/docx/pptx/pdf/text) |
| `favicon.png`, `apple-touch-icon.png`, `icon-*.png`, `og-image.png`, `manifest.webmanifest` | Icons and the install manifest |

### `src/editor/` — the editor and the registry worker

| Module | Purpose |
| --- | --- |
| `editor.mjs` | The editor as the page sees it; one API answered by one of two halves |
| `monaco-editor.mjs` | Monaco itself (0.82 MB chunk, never on `?view=app`/`full`); `lockEditor()`, `markLines()`, `showDiff()`/`closeDiff()` |
| `file-store.mjs` | The other half: a plain file list for app-only pages |
| `files.mjs` | File naming and checks (abapGit names, test includes, tables) |
| `analysis.mjs` | One analysis, three readers; applies `parser-hint.mjs` |
| `parser-hint.mjs` | The missing-full-stop question on abaplint's `parser_error`, and `borrowedSyntax()`: the ABAP spelling of CDS/SQL/JavaScript shapes it refuses |
| `tables.mjs` | Tables of your own: rows parser, table check, starter `zproducts`, abapGit data config |
| `app-from-table.mjs` | **→ App**: the class for a table - a list of its rows, a dialog to add, change, delete |
| `registry.mjs` | The page's client of the registry worker |
| `registry-worker.mjs` | The worker's entry: abaplint, the corpus, the transpiler |
| `registry-core.mjs` | abaplint as it runs there; `formatFiles()`, `FORMAT_RULES`, clock-yielded parse |
| `transpile-core.mjs` | Single-object transpile in the worker; source maps for dumps |
| `transpile.mjs` | The page's side of the compile |
| `providers.mjs` | Monaco's language providers over the worker |
| `lint-core.mjs` | The abap2UI5 linter in the worker |
| `lint-entry.mjs` | The linter's bundle (`dist/editor/lint.mjs`) |
| `abap2ui5-lint.mjs` | The linter's page half: settings, `settingsFor()`, `ruleUrl()` |
| `sample-list.mjs` | Class names of the samples the page carries (Node-readable) |
| `samples.mjs` | Those samples assembled; `loadSampleFiles()`, `isSample()` |

### `src/runtime/` — the ABAP side, in a worker

| Module | Purpose |
| --- | --- |
| `worker.mjs` | The framework bundle's entry, answering over `postMessage`; imports `lockdown.mjs` first |
| `lockdown.mjs` | Takes `caches`, `indexedDB`, `Worker`, `SharedWorker`, `navigator.serviceWorker` off the worker before user code runs |
| `index.mjs` | `roundtrip()` (with `console`, `state`), `defineClasses()` (class and DDIC put-back), `runUnitTests()`, `locate()`, user tables |
| `app-state.mjs` | The State tab's snapshot (`snapshot()`, bounded) |
| `db-setup.mjs` | sql.js, the empty-database image, `resetDatabase()` |
| `loaded.mjs` | Says the bundle arrived, before evaluation |
| `browser-console.mjs`, `buffer-shim.mjs`, `node-crypto-shim.mjs` | Shims for Node's console (WRITE), `Buffer`, `crypto` |

### Everything else

| Path | Purpose |
| --- | --- |
| `src/catalogue/` | `/samples/`: `index.html`, `catalogue.css`, `catalogue.mjs` (the page), `search-entry.mjs` (→ `samples/search.mjs`), `page-entry.mjs` (→ `samples/page.mjs`: site memory, `outline.mjs`, `lines.mjs`, `run-jump.mjs`), `sample.css` (sample pages) |
| `src/vendor/agent/` | abap2UI5/mcp-server's agent client, copied **unchanged** by `tools/vendor-agent.mjs` (`source.json`; `--check`). Never edited here |
| `src/abap/` | `zcl_pg_bridge`, the playground's only ABAP |
| `src/examples/` | ABAP served statically so `?src=` tests have same-origin targets |
| `src/embed/` | `abap2ui5-embed.js` (the loader), `index.html` ("Eight shapes"), `host.html` (smallest embedding) |
| `src/fonts/` | Inter, self-hosted (`NOTICE.md`) |
| `tools/build.mjs` | `npm run build`: the five steps, 2 and 3 together |
| `tools/fetch-deps.mjs` | The pins (framework, frontend, open-abap-core, samples); `--update-pins`, `--print-latest` |
| `tools/build-framework.mjs` | Downport, transpile, bundle → `dist/runtime/framework.mjs` |
| `tools/build-ui5.mjs` | The UI5 frontend → `dist/app/`; `frameOptions` and `checkLocal` patches |
| `tools/build-catalogue.mjs` | `dist/samples/apps.json`, and the sample pages through `sample-pages.mjs` |
| `tools/sample-pages.mjs` | One page per sample, `samples/all/`, sitemap, `llms.txt` |
| `tools/sample-frame.mjs` | The frame those pages share (bar, footer, `THEME_SCRIPT`, `MENU_SCRIPT`) |
| `tools/not-found-page.mjs` | `dist/404.html`, which guesses |
| `tools/sample-sources.mjs` | The printed ABAP, one tarball per ref |
| `tools/abap-highlight.mjs` | Build-time ABAP colouring (published: the docs import it) |
| `tools/html.mjs` | Comment stripping and `withPolicy()` (CSP) for every written document |
| `tools/build-site.mjs` | The page, worker, linter and catalogue bundles; corpus; samples (`lessons.json`); examples; embed |
| `tools/site-documents.mjs` | `writeIndex()`, the AI and Pilot pages, `preloadsFor()`, `writeCatalogueDocument()` |
| `tools/service-worker.mjs` | `writeServiceWorker()`: build id, hashes, precached chunks |
| `tools/esbuild-plugins.mjs` | The load-bearing esbuild plugins (shims, stubs, Monaco CSS) |
| `tools/check-size.mjs` | The size budget and the stack budget |
| `tools/serve.mjs` | Dev/test server; mounts `dist/` three ways, answers misses with `404.html` |
| `tools/vendor-agent.mjs` | Vendors and checks `src/vendor/agent/` |
| `tools/ai-eval-summary.mjs` | The AI Studio's measurement (`ai-eval.jsonl`) as the job summary's table; fails on a task without a line |
| `tests/*.spec.js` | Playwright against the built `dist/` (`bfcache.spec.js` reads rather than runs) |
| `tests/node/*.test.mjs` | `node:test` over the pure modules; `dom.mjs` over `@xmldom/xmldom`; fixture from abap2UI5/samples `z2ui5_cl_smp_app_494` |
| `tests/fixtures/` | Office/PDF files for the chats, unit-test ABAP |

## Build, run, test

```sh
npm ci
npm run build      # deps -> framework + UI5 (together) -> catalogue -> site; first run takes minutes
npm run serve      # dist/ on http://localhost:8080, also under a subpath
npm test           # Playwright (chromium) against the built dist/
npm run check      # build -> check:size -> test, what check.yml runs
npm run lint       # ESLint
npm run typecheck  # tsc over files that start with // @ts-check (jsconfig: checkJs off)
npm run test:unit  # node:test over tests/node/*.test.mjs - no build, no browser
```

- `npm test` alone runs against whatever `dist/` holds; on a fresh clone it
  fails as a 30-second `webServer` timeout. `npm run check` cannot be typed in
  the wrong order. It leaves out `npx playwright install chromium`, a download
  `npm test` asks for by name (CONVENTIONS section 3 asks for this to be said).
- `PORT=8091 npm test` moves the test server and `baseURL` together, so two
  checkouts can test at once. `PW_WEBKIT=1` adds the WebKit project (boot, embed, shell specs).
- `PG_DEBUG=1` builds unminified bundles with source maps.
- `RUNNABLE_JSON=/tmp/runnable.json npm test -- docs-examples` runs the
  documentation's runnable examples here — a measurement, not part of `npm test`
  ([public-surfaces.md](docs/design/public-surfaces.md)).
- `AI_EVAL_KEY=sk-ant-… npm test -- ai-eval` has a real model build the apps of
  `tests/fixtures/ai-eval-tasks.json` in the AI Studio and writes a line per task
  to `test-results/ai-eval.jsonl` — a measurement billed to the key, not part of
  `npm test` ([ai-chat.md](docs/design/ai-chat.md)).
- The full suite is 422+ tests, about 25 minutes on 4 cores in one run. Every
  test boots its own playground on purpose ([testing.md](docs/design/testing.md)).

## CI

| | |
|---|---|
| `check.yml` | Every non-main branch and PR: a `lint` job (lint, typecheck, test:unit) beside four test shards — Chromium `--shard=n/3` ×3 and WebKit on its own — each building with `.github/actions/build` (caches for `deps/`, `~/.ui5`, the downport) and checking the size budget. Two workers per runner, traces on retry, the service worker blocked except in `worker.spec.js` |
| `pages.yml` | Pushes to `main` and **nightly**: the same lint job and four shards, a fifth runner building the artefact, deploy once all are green (`needs: [lint, test, build]`), then `notify-docs` dispatches `playground-published` to abap2UI5/docs (`DOCS_DISPATCH_TOKEN`) |
| `upstream.yml` | Weekly: build and test against upstream `HEAD` without moving pins; opens or extends an issue on failure |
| `ai-eval.yml` | Weekly, after a merge that moves the pins or the studio's rules, and by hand: `tests/ai-eval.spec.js` against the real model with the `ANTHROPIC_API_KEY` secret, the table in the job summary (`tools/ai-eval-summary.mjs`), the lines as an artifact. A measurement, not a gate - red only when a task wrote no line; without the secret a green no-op |
| `bump-linter.yaml` | Weekly: pins `@abap2ui5/linter` to its latest release behind the full gate |
| `bump-sources.yaml` | Weekly: `fetch-deps.mjs --update-pins` (runtime pins together, samples pin beside) behind the full gate |
| `dependabot.yml` | Monthly npm and action pins, majors separated |

The tests are the gate: everything user-visible runs through a real browser,
and `tests/samples.spec.js` drives every carried sample, so a sample without a
test is not possible. A red test never publishes.

## Toolchain

Node 22 — `engines.node` is `>=22` and `.nvmrc` says `22` (CONVENTIONS
section 4). Every npm dependency is pinned **exactly**: the transpiler,
abaplint and the linter end up inside the bundle a visitor downloads, so
"whatever resolves today" would change the site under its own tests. The dev
tooling is pinned the same way (eslint 10.12.0, @eslint/js 10.0.1, globals
17.12.0, typescript 6.0.3, @xmldom/xmldom 0.9.12). Actions are pinned to
commits. Type checking is opt-in per file (`// @ts-check`); a module joins by
adding the comment and passing.

The linter is bumped weekly by `bump-linter.yaml`, not Dependabot (a 0.x
minor is a "major" there, and the pin once sat four minors behind); the build
refuses a linter whose UI5 metadata disagrees with `UI5_VERSION`. The
git-source pins move through `bump-sources.yaml` (the frontend leads, its
`result/cloud/VERSION` names the framework commit, the framework names
open-abap-core; samples to their own HEAD), so a sample renamed upstream is a
red bump PR, not a page that opens on nothing. By hand: edit the sha in
`tools/fetch-deps.mjs`. The samples pin decides what the page opens on — a
bump of it is a change to the site.

## Rules

Each bullet names the design doc that explains it. Keep them true.

**Build** ([build-pipeline.md](docs/design/build-pipeline.md), [build-traps.md](docs/design/build-traps.md))
- No samples live here. They are class names in `src/editor/sample-list.mjs`, resolved against the samples pin; a missing class fails the build with its name.
- Every build step is cached by a stamp over its inputs AND checks its outputs exist. Run abaplint and the transpiler from `node_modules/.bin` by path, never `npx`.
- The transpiler's `addCommonJS` and the esbuild flags (`keepNames`, injected `Buffer`, console/crypto shims) are load-bearing; the generated frontend (`z2ui5_cl_ui5f_*`) is a stub in the bundle.
- `build-ui5.mjs` must fail loudly if `frameOptions="trusted"` or the ComponentSupport `data-settings` it patches are no longer there.
- Generated markers (`modulepreload`, `__EDITOR_PRELOADS__`, `__EDITOR_CSS__`, `__THEME_BOOT__`, `__THEME_MENU__`, the precache list) are written by the build, never by hand.

**Runtime** ([runtime.md](docs/design/runtime.md))
- The frame POSTs to its own URL because the component gets `checkLocal: true` in its component data; `window.z2ui5` no longer exists. The bridge intercepts by origin and pathname only.
- Frame and page exchange messages only (`frame-link.mjs` ↔ `frontend-bridge.js`), never reach into each other's window or document; nothing secret goes to a frame. On `/ai/` and `/pilot/` the frame is sandboxed without `allow-same-origin`.
- The runtime worker imports `lockdown.mjs` before anything else.
- Run = a fresh database (SQLite reopened on the empty image, user tables rebuilt from their text) and the app restarted in place where possible.

**Load time** ([load-time.md](docs/design/load-time.md))
- Both workers start from the inline script in `index.html`; the preloads must match what the page actually fetches; `boot()`'s two orderings and `heard()` keep costs overlapping.
- The service worker caches a core asset only if it hashes to the build, and a cached hit is verified before it is served (`verifiedHit()`) - under `app/` against `dist/app-hashes.json`, which the worker knows by its hash; the documents and catalogue files are network-first; a new document must be added to `DOCUMENTS` in `sw.js` and to `writeServiceWorker()`.
- A chunk never imports a shell module (`editor.mjs`, `insight.mjs`, `file-sets.mjs`, `deep-link.mjs`, …) — what it needs is handed to its setup function, or esbuild splits the shell.
- The size budget sums `assets/*.mjs`; the shell entry and its static imports stay free of Monaco and `shell.css` free of Monaco's CSS; the corpus must parse in 256 KB of stack.
- Never `window.prompt()`/`alert()` (dead in a cross-origin frame); never treat `blur` as cancel in a shell input (the app frame steals focus); every `localStorage` and `sessionStorage` access through `storage.mjs` (bar `theme-boot.mjs`).
- Nothing may keep a page out of the back/forward cache: no `unload`, no `beforeunload`, no `no-store` (`tests/bfcache.spec.js`).

**Editor and checkers** ([checkers.md](docs/design/checkers.md), [format.md](docs/design/format.md), [panel.md](docs/design/panel.md))
- An abaplint error blocks Run; an abap2UI5 linter finding never does. The two use separate Monaco marker owners.
- A stored setting (checkers, theme, Auto, draft) is validated like a typed one, forgotten when it equals the default, and never restored in an embedded playground. A file set identical to a carried sample is not stored as a draft.
- Format, Fix them, View edit and Reset to original: one edit per file (one Ctrl+Z), nothing without a correct answer guessed. Format is one implementation for the button and Shift+Alt+F; `FORMAT_RULES` is layout only — never `keyword_case`, `indentation`, `align_parameters`, `line_break_multiple_parameters`, `keep_single_parameter_on_one_line`.
- View edit: what nobody edited is not rewritten; what it cannot do it refuses with a sentence, never guesses.

**Phone** ([phone.md](docs/design/phone.md))
- Below 820px the toolbar is one row and every `data-overflow` control moves into its ⋯ menu (the same element, still reachable); the panel starts folded; Run brings the app forward only when it started one; autorun never moves the caret or the pane.

**AI** ([ai-chat.md](docs/design/ai-chat.md), [ai-pilot.md](docs/design/ai-pilot.md))
- A key or token is held in memory for the visit and never stored; a key goes only to the server it was typed for. The Pilot opens a link's code only after asking (the app steers the model); the Gist section asks once a link's code has run (the playground's frame is same-origin).
- The model's tools go through the same paths as the reader's (`replaceWith()`, `run()`); the conversation is append-only (bar `rewind()` of the last exchange); agent chunks stay out of the precache.
- Both rooms keep their conversation for the tab in sessionStorage (`keepConversation()` in `chat.mjs` and `pilot.mjs`), never the key; the studio's files under `AI_STORAGE_KEY` in localStorage. Nothing of it asks for `beforeunload`.
- The studio's target system is abaplint's `version`, nothing of its own: the header sets it the way the Config tab does, and the model is told the release the check runs at, never another.
- `src/vendor/agent/` is never edited here — change upstream and re-vendor.

**Public surfaces and the site** ([public-surfaces.md](docs/design/public-surfaces.md), [sample-catalogue.md](docs/design/sample-catalogue.md), [one-site.md](docs/design/one-site.md))
- Share links, `?src=`, `?gist=`, `?embed=`, `?view=`, `?readonly=`, `?lines=`, the embed loader and its messages, `abap-highlight.mjs`'s export and `apps.json`'s fields are contracts with abap2UI5/docs; a docs change needing new behaviour ships after the playground deploy. External pages build URLs with `abap2ui5Embed.url()`.
- An embedded playground never reads or writes the stored draft or settings. The first-steps strip never shows on an embed, an app-only page, the AI pages or anything a link opened.
- `#playground=` (the share fragment) is read by abap2UI5/layout-editor too.
- The catalogue build degrades per repository and never fails the build; everything on sample pages is escaped, links are `https` only, documents go out through `withPolicy()`.
- The bar, the menu, the palette and the font exist in several copies across two repositories — change them together, playground first. `search-engine.mjs` is a copy of the docs repo's; a change to matching starts there.

**Tests** ([testing.md](docs/design/testing.md))
- Anything user-visible is tested through a real browser against the built `dist/`; pure modules may add `node:test` tests in `tests/node/`.
- Every spec starts with the first-steps strip closed (`use.storageState` in `playwright.config.js`); only `tests/onboarding.spec.js` clears it.

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
  refused ([docs/history/PLAYGROUND_PLAN.md](docs/history/PLAYGROUND_PLAN.md),
  phase 8): restored rows would be orphaned data, or would revive an instance
  of an old shape of the class. "Run starts fresh" is the promise — and it
  holds for tables of your own too: they are rebuilt from their text at every
  reset, and nothing an app writes to them is kept.
- **The corpus ships whole — method bodies and all, for everything the editor
  can be asked about.** The one exception is abap2UI5's generated frontend
  (`src/01/03`), which is not ABAP anybody reads and is left out for the stack
  rather than for the bytes (the third trap in
  [load-time.md](docs/design/load-time.md)). For the rest: it is the largest
  single thing the editor waits on and the obvious place to look for a saving,
  so here is the measurement. Emptying every `METHOD … ENDMETHOD` takes
  `corpus.json` from 0.60 MB compressed to 0.21 MB and roughly halves the parse
  (measured before the generated frontend came out, which alone took it to
  0.43 MB). But of the 3.8 MB of ABAP, 2.9 MB is abap2UI5 and only 0.8 MB
  open-abap — stripping only the standard library saves 0.05 MB. The saving
  needs the abap2UI5 sources to go too, and those are what somebody
  control-clicks into to see how the framework does something. Reading the
  framework is the playground; a tenth of the download does not buy it.
- **The generated frontend is a stub in the framework bundle.** The 69
  `z2ui5_cl_ui5f_*` classes are registered by name and throw a sentence from
  `get()`; only the http handler's GET branch reads them, and the playground
  never GETs — the frame's document comes from `dist/app`. Wiring that branch
  up would mean carrying 1.7 MB of frontend text a second time for nothing
  on screen.
- **The open-abap classes the framework never reaches stay in its bundle.**
  Measured 2026-10-10: 93 of them that nothing names (0.59 MB of the 7.3 MB
  transpilat); stubbing 31 saved 0.04 MB compressed and nothing at boot (V8
  compiles an uncalled class lazily), and would make a catalogued sample that
  reaches one (`cl_abap_datfm`, `cl_abap_dyn_prg`) die with the stub's
  message where the gate cannot see it. Not worth it.
- **The `?src=` host allow list stays short.** The playground fetches on
  behalf of whoever opened the link and must not become a general-purpose
  reader for arbitrary URLs.

More "measured and refused" notes live beside the area they belong to — the
test suite's one-boot-per-test ([testing.md](docs/design/testing.md)), the
preloads and load-time numbers ([load-time.md](docs/design/load-time.md)), the
sample pages' per-line markup and the 220 MB site budget
([sample-catalogue.md](docs/design/sample-catalogue.md)).

## Read the design doc before touching…

| You are touching | Read |
| --- | --- |
| `tools/`, the build steps, pins, stamps, esbuild, bundle splitting | [build-pipeline.md](docs/design/build-pipeline.md), [build-traps.md](docs/design/build-traps.md) |
| `src/runtime/`, `lockdown.mjs`, `frontend-bridge.js`, `frame-link.mjs`, `run.mjs`, restart in place, tables, WRITE, state | [runtime.md](docs/design/runtime.md), [build-traps.md](docs/design/build-traps.md) |
| Boot order, workers, preloads, warm-up, chunks, `sw.js`, `site-cache.mjs`, `check-size.mjs`, `storage.mjs`, dialogs/focus | [load-time.md](docs/design/load-time.md) |
| The narrow layout, toolbar and ⋯ menu, panel strip, Auto (`autorun.mjs`) | [phone.md](docs/design/phone.md) |
| Format, `FORMAT_RULES`, the formatting provider | [format.md](docs/design/format.md) |
| abaplint, the linter, Config tabs, `ui5-floor.mjs`, stored settings, the draft (`file-sets.mjs`), Fix them, Reset, the parser hint | [checkers.md](docs/design/checkers.md) |
| The bottom panel's tabs, View edit (`chain-*.mjs`, `view-edit.mjs`), unit tests, dumps, `guides.mjs`/`first-steps.mjs`/`learn-path.mjs` | [panel.md](docs/design/panel.md) |
| The AI Studio, providers, keys, attachments, `agent-hooks.mjs`, `linked-code.mjs` | [ai-chat.md](docs/design/ai-chat.md) |
| The AI Pilot, `frame-drive.mjs`, the vendored agent client | [ai-pilot.md](docs/design/ai-pilot.md) |
| Share, `?src=`, `?gist=`, `?embed=`/`?view=`/`?readonly=`/`?lines=`, the samples dialog, `original.mjs`, `layout-editor.mjs`, `src/embed/` | [public-surfaces.md](docs/design/public-surfaces.md) |
| `src/catalogue/`, `build-catalogue.mjs`, sample pages, the 404 | [sample-catalogue.md](docs/design/sample-catalogue.md) |
| The bar, palette, font, search box, site memory, anything shared with abap2UI5/docs | [one-site.md](docs/design/one-site.md) |
| `tests/`, `playwright.config.js`, CI workflows | [testing.md](docs/design/testing.md) |
