// The abap2UI5 linter's bundle: what lint-core.mjs loads into the registry
// worker when the worker starts, as dist/editor/lint.mjs - a bundle of its
// own beside the worker's rather than a chunk split off it, because a chunk
// shares its helpers with the entry, and that shared piece became a static
// import the worker had to fetch before it could run a line: one more round
// trip in front of the corpus fetch, which is the one thing the worker exists
// to start early. tools/build-site.mjs writes it; nothing else imports this.
export { checkAbapSource } from "@abap2ui5/linter";
export { applyFixes, isFixable } from "@abap2ui5/linter/fix";
