// What the built-in samples are, without a line of ABAP in it.
//
// Ordered by what each one adds: the first is the smallest app that does
// something, the last uses a value help, a popup and a table together. Every
// sample is a class called ZCL_PLAYGROUND, because that is what the playground
// compiles and starts, and every one is driven by tests/samples.spec.js - a
// sample that no longer runs is a broken promise, not a stale file.
//
// The ABAP itself lives in src/samples/<id>/, one real .clas.abap file per
// object, and `files` names them relative to that directory. Two things
// follow, and both are why they are files rather than the template literals
// this used to be a thousand lines of:
//
//   - the samples browser links every row to where its code lives, and for a
//     built-in that link used to open src/editor/samples.mjs - a JavaScript
//     file with the ABAP quoted inside it. It opens the ABAP now.
//   - anything that reads ABAP - an editor, abaplint, a diff - reads these.
//
// This module is the half of the catalogue that is plain data, so that Node
// can import it: src/editor/samples.mjs pairs it with the sources, and does
// that through imports only a bundler resolves (see the .abap loader in
// tools/build-site.mjs). The tests import the list from here.
export const SAMPLE_LIST = [
  {
    id: "hello",
    title: "Hello world",
    note: "input, button, binding",
    files: ["hello/zcl_playground.clas.abap"],
  },
  {
    id: "counter",
    title: "Counter",
    note: "state across roundtrips",
    files: ["counter/zcl_playground.clas.abap"],
  },
  {
    id: "table",
    title: "Table with selection",
    note: "internal table, row template",
    files: ["table/zcl_playground.clas.abap"],
  },
  {
    id: "form",
    title: "Form and validation",
    note: "message box, layout library",
    files: ["form/zcl_playground.clas.abap"],
  },
  {
    id: "tabs",
    title: "Tabs and a list",
    note: "event arguments, growing table",
    files: ["tabs/zcl_playground.clas.abap"],
  },
  {
    id: "popup",
    title: "Confirmation popup",
    note: "nav_app_call, on-navigated",
    files: ["popup/zcl_playground.clas.abap"],
  },
  {
    id: "unit-tests",
    title: "Unit tests",
    note: "a test include, run before the app",
    files: ["unit-tests/zcl_playground.clas.abap", "unit-tests/zcl_playground.clas.testclasses.abap"],
  },
  {
    id: "navigation",
    title: "Two apps",
    note: "nav_app_call between your own classes",
    files: ["navigation/zcl_playground.clas.abap", "navigation/zcl_detail.clas.abap"],
  },
  // Two samples that are deliberately WRONG, one per checker, so the Fix
  // button has something to do the moment somebody wants to see what it does.
  // Both are small: the point is the repair, not the app. `startsBroken` says
  // the sample does not come up running, which is its point - the tests read
  // it and drive the repair instead of the app, so the promise that every
  // sample in the menu works still holds; it just means something different
  // for these two.
  //
  // The first is abaplint's: a method is declared and never implemented,
  // which is an error, so Run is blocked - there is nothing to start.
  {
    id: "fix-abaplint",
    title: "Quick fix: abaplint",
    note: "a method with no implementation - Run is blocked until it is fixed",
    files: ["fix-abaplint/zcl_playground.clas.abap"],
    startsBroken: "blocked",
  },
  // And this one is the abap2UI5 linter's: the app runs, and the control it
  // asks for never loads.
  {
    id: "fix-abap2ui5",
    title: "Quick fix: abap2UI5 lint",
    note: "an undeclared namespace - it runs, and the control never loads",
    files: ["fix-abap2ui5/zcl_playground.clas.abap"],
    startsBroken: "runs",
  },
];

// Where a sample's file lives in this repository - what the samples browser
// links a built-in row to, the same way it links a catalogued one to its
// class in the repository the catalogue came from.
export const SAMPLES_DIR = "src/samples";
export const samplePath = (file) => `${SAMPLES_DIR}/${file}`;
