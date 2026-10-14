// The abap2UI5 linter's bundle: what lint-core.mjs loads into the registry
// worker when the worker starts, as dist/editor/lint.mjs - a bundle of its
// own beside the worker's rather than a chunk split off it, because a chunk
// shares its helpers with the entry, and that shared piece became a static
// import the worker had to fetch before it could run a line: one more round
// trip in front of the corpus fetch, which is the one thing the worker exists
// to start early. tools/build-site.mjs writes it; nothing else imports this.
//
// From `./check`, not the package's main entry: that one adds checkFiles( )
// with its worker pool (`node:worker_threads`, since linter 0.9.0) and the
// renderer, neither of which a browser bundle can resolve - the main entry
// is the CLI's, `./check` is the one the linter keeps free of Node for a
// bundle like this one (its own test suite holds it to that).
export { checkAbapSource } from "@abap2ui5/linter/check";
export { applyFixes, isFixable } from "@abap2ui5/linter/fix";
