# abap2UI5 Playground

A browser playground for [abap2UI5](https://github.com/abap2UI5/abap2UI5): ABAP
in an editor on the left, the running UI5 app on the right, and nothing in
between but the browser. No server, no SAP system, no backend of any kind - the
ABAP is compiled to JavaScript in a web worker and executed on the page.

Status: under construction. The work is planned and tracked in
[PLAYGROUND_PLAN.md](PLAYGROUND_PLAN.md).

## How it works

The [abaplint transpiler](https://github.com/abaplint/transpiler) translates
ABAP to JavaScript. abap2UI5 already relies on it: its CI transpiles the whole
framework and runs the ABAP unit tests under Node. The playground takes that
same pipeline and moves the last step into the browser.

- **Build time.** The abap2UI5 sources are downported to 702-compatible syntax
  (abaplint `--fix`), transpiled, and bundled into one static ESM module, along
  with the open-abap standard library. This is the slow part and it happens
  once, in CI.
- **Page load.** That bundle is loaded, the ABAP runtime is initialized, and an
  in-memory SQLite database (sql.js, compiled to WebAssembly) takes the place of
  the database the framework stores its drafts in.
- **Editing.** Monaco - the editor from VS Code - runs abaplint in a web worker
  against a registry that holds the framework sources, so completion and syntax
  checks know about `z2ui5_cl_ui5_view_builder` and friends.
- **Run.** Only the class in the editor is downported and transpiled, live, in
  the worker. The resulting module is imported and registered with the runtime.
- **Rendering.** The abap2UI5 UI5 frontend runs in an iframe. It talks to its
  backend over plain `fetch` POSTs, so the playground replaces `window.fetch`
  for that one URL with a shim that hands the request body to the transpiled
  HTTP handler and returns its answer. From the framework's point of view
  nothing changed.

## Development

```sh
npm ci
npm run build     # pins deps, builds the framework bundle, assembles dist/
npm run serve     # serves dist/ on http://localhost:8080
npm test          # Playwright tests against a freshly built dist/
```

The git dependencies (abap2UI5 itself, open-abap-core) are pinned by commit in
`tools/fetch-deps.mjs`. To bump one:

```sh
node tools/fetch-deps.mjs --print-latest
# edit the sha in tools/fetch-deps.mjs
npm run build && npm test
```

## Deployment

`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages on
every push to `main`, after the tests pass. `.github/workflows/check.yml` runs
the same build and tests on every branch and pull request.

> **Setup required once, by a repository admin:** Settings → Pages → Source →
> "GitHub Actions". Until that is switched on the deploy job fails and the
> published page does not exist.

## License

MIT. abap2UI5 and the abaplint tooling are the work of their respective
authors and carry their own licenses.
