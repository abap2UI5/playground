// What the playground knows about itself. One object, so the modules that make
// up the page do not have to reach into each other.
export const state = {
  // The transpiled framework, once it has loaded (src/runtime/index.mjs).
  runtime: undefined,

  // The class the app frame starts. Until the editor exists this is the
  // built-in demo; from then on it is the class the editor holds.
  appClass: "ZCL_PG_HELLO",

  // Bumped on every run so each frame load is its own document.
  runCounter: 0,
};
