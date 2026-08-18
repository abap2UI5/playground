// What the playground knows about itself, beyond what the editor and the DOM
// already hold. Two fields, on purpose: everything else about the current state
// - which files are open, what is in them, which one is showing - is the
// editor's, and a second copy of it would only ever be the stale one.
export const state = {
  // The transpiled framework, once it has loaded (src/runtime/index.mjs).
  runtime: undefined,

  // Bumped on every run so each frame load is its own document, which is what
  // keeps the browser from serving a cached one.
  runCounter: 0,
};
