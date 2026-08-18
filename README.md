# abap2UI5 Playground

Write [abap2UI5](https://github.com/abap2UI5/abap2UI5) apps in the browser. ABAP
on the left, the running app on the right, and nothing in between but the
browser — no server, no SAP system, no backend of any kind.

![The playground: an ABAP class on the left, the app it produces on the right](docs/playground.png)

## How it works

The [abaplint transpiler](https://github.com/abaplint/transpiler) translates ABAP
to JavaScript. abap2UI5 already relies on it — its CI transpiles the whole
framework and runs the ABAP unit tests under Node. The playground takes that
pipeline and moves the last step into the browser.

```
                     ┌──────────────────────── the page ────────────────────────┐
                     │                                                          │
  build time         │   Monaco + abaplint            the ABAP runtime          │
  ──────────         │   ┌─────────────────┐          ┌──────────────────┐      │
  abap2UI5 sources ──┼──▶│ registry:       │          │ abap2UI5,        │      │
  (910 files)        │   │ the real        │  Run     │ transpiled at    │      │
                     │   │ framework       │──ABAP───▶│ build time       │      │
  abap2UI5 src ──────┼──▶│ + your class    │  → JS    │ + your class     │      │
  downported,        │   └─────────────────┘          └────────┬─────────┘      │
  transpiled,        │                                         │ roundtrip      │
  bundled            │   ┌─────────────────────────────────────▼─────────┐      │
                     │   │ iframe: the abap2UI5 UI5 frontend             │      │
  OpenUI5 ───────────┼──▶│ window.fetch redirected to the runtime above  │      │
  built from npm     │   └───────────────────────────────────────────────┘      │
                     └──────────────────────────────────────────────────────────┘
```

- **Build time.** The abap2UI5 sources are downported to 702-compatible syntax
  (abaplint `--fix`), transpiled, and bundled into one static module along with
  the open-abap standard library. The UI5 frontend is built against a pinned
  OpenUI5, so the site carries its own UI5 rather than linking a CDN.
- **Page load.** That bundle boots the ABAP runtime, and an in-memory SQLite
  (sql.js, compiled to WebAssembly) takes the place of the database abap2UI5
  keeps its drafts in. In parallel, abaplint parses the real framework sources so
  the editor can check your class against them.
- **Editing.** Monaco — the editor from VS Code — with abaplint behind it:
  diagnostics against the actual framework, hover, go to definition, rename,
  references, quick fixes and the pretty printer.
- **Run.** Only the class in the editor is compiled, in about 20 ms, and
  registered with the running runtime.
- **Rendering.** The abap2UI5 frontend runs in an iframe and talks to its backend
  over a plain `fetch` POST, so the playground replaces `window.fetch` for that
  one request with a call into the framework in the parent page. From the
  framework's point of view nothing changed.

Roughly 3 MB travels to a visitor, compressed: the page bundle, the transpiled
framework, the ABAP corpus and SQLite. UI5 loads its libraries on demand on top
of that.

## What it can and cannot do

**It runs real abap2UI5.** Not a subset and not a simulation: the framework in
the page is the framework from the repository, at a pinned commit, and the
roundtrip it answers is the one a real system answers. Modern ABAP works as
written — inline declarations, `VALUE #( FOR … )`, `COND #`, string templates,
table expressions.

Where it stops:

- **One class.** The playground compiles and starts a single global class called
  `ZCL_PLAYGROUND`. Local classes inside it are fine; a second global class is
  not.
- **No database of your own, no RFC, no files.** There is a database, but it
  holds the framework's own tables. `SELECT` from a business table has nothing to
  select from, and nothing can reach outside the browser.
- **Only what the transpiler implements.** It covers a lot, and abap2UI5's whole
  CI depends on it, but it is not an ABAP kernel. Anything it cannot compile is
  reported in the output panel rather than failing silently.
- **Only the UI5 libraries that were built in.** `sap.m`, `sap.f`,
  `sap.ui.core`, `sap.ui.layout`, `sap.ui.table`, `sap.ui.unified`, `sap.tnt`,
  `sap.uxap`. A control from anywhere else will not load — see `UI5_LIBRARIES` in
  `tools/build-ui5.mjs`.
- **State lives in the tab.** Reloading the page starts over, and so does
  pressing Run. Your code is kept in local storage; the app's data is not.

## Sharing

**Share** puts the whole class in the URL fragment, deflated: a 2500-character
class becomes a link of about 700 characters. Being a fragment, it never leaves
the browser — it is not sent to the server and does not appear in any log.

## Development

```sh
npm ci
npm run build     # pins deps, builds the framework, builds UI5, assembles dist/
npm run serve     # serves dist/ on http://localhost:8080
npm test          # Playwright, against a freshly built dist/
```

The first build takes a few minutes: the downport is three of them and the UI5
build one. Both are cached by a hash of their inputs, so the second build is
seconds.

| | |
|---|---|
| `tools/fetch-deps.mjs` | pins abap2UI5 and open-abap-core by commit under `deps/` |
| `tools/build-framework.mjs` | downport → transpile → `dist/runtime/framework.mjs` |
| `tools/build-ui5.mjs` | the abap2UI5 frontend built against OpenUI5 → `dist/app/` |
| `tools/build-site.mjs` | the page bundle and the ABAP corpus the editor uses |
| `tools/check-size.mjs` | the budget for what a visitor downloads |

`src/runtime` is the ABAP side of the page, `src/editor` is Monaco and abaplint,
`src/shell` is the page around them, and `src/abap` is the handful of ABAP the
playground adds to the framework.

### Bumping abap2UI5 or OpenUI5

```sh
node tools/fetch-deps.mjs --print-latest   # what upstream has today
# edit the sha in tools/fetch-deps.mjs (or UI5_VERSION in tools/build-ui5.mjs)
npm run build && npm test
```

A weekly workflow (`.github/workflows/upstream.yml`) builds and tests against
upstream `HEAD` without changing the pins, and opens an issue when that stops
working — so a bump is a two-line commit rather than an investigation.

## Deployment

`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages on
every push to `main`, after the tests pass. `.github/workflows/check.yml` runs
the same build and tests on every other branch and pull request.

> **Setup required once, by a repository admin:** Settings → Pages → Source →
> "GitHub Actions". Until that is switched on the deploy job fails and the
> published page does not exist.

## Where the work is written down

[PLAYGROUND_PLAN.md](PLAYGROUND_PLAN.md) is the plan this was built from, phase
by phase, with what each phase turned out to cost and the traps found on the way
— the transpiler flag without which nothing links, the bundler option without
which ABAP's own type system stops working, the caches that have to be dropped
when a class is redefined. Read it before changing the build.

## License

MIT. abap2UI5, abaplint and OpenUI5 are the work of their respective authors and
carry their own licenses.
