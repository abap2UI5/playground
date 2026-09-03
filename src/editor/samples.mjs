// The catalogue the samples browser offers, assembled: the list in
// sample-list.mjs, and the ABAP of every file in it.
//
// The sources are `import`ed from src/samples/ as text, which only the bundler
// can do - tools/build-site.mjs gives esbuild an `.abap` text loader for
// exactly these. That is why the list itself lives in a module of its own:
// Node imports that one (the tests do), and only the page imports this.
//
// One import per file, written out rather than generated, because a bundler
// has to see every one of them statically - and because a sample that is in
// the list and in no import fails the build here rather than opening empty in
// somebody's editor.
import { SAMPLE_LIST, samplePath } from "./sample-list.mjs";

import HELLO from "../samples/hello/zcl_playground.clas.abap";
import COUNTER from "../samples/counter/zcl_playground.clas.abap";
import TABLE from "../samples/table/zcl_playground.clas.abap";
import FORM from "../samples/form/zcl_playground.clas.abap";
import TABS from "../samples/tabs/zcl_playground.clas.abap";
import POPUP from "../samples/popup/zcl_playground.clas.abap";
import UNIT_APP from "../samples/unit-tests/zcl_playground.clas.abap";
import UNIT_TESTS from "../samples/unit-tests/zcl_playground.clas.testclasses.abap";
import NAV_HUB from "../samples/navigation/zcl_playground.clas.abap";
import NAV_DETAIL from "../samples/navigation/zcl_detail.clas.abap";
import FIX_ABAPLINT from "../samples/fix-abaplint/zcl_playground.clas.abap";
import FIX_ABAP2UI5 from "../samples/fix-abap2ui5/zcl_playground.clas.abap";

const SOURCES = {
  "hello/zcl_playground.clas.abap": HELLO,
  "counter/zcl_playground.clas.abap": COUNTER,
  "table/zcl_playground.clas.abap": TABLE,
  "form/zcl_playground.clas.abap": FORM,
  "tabs/zcl_playground.clas.abap": TABS,
  "popup/zcl_playground.clas.abap": POPUP,
  "unit-tests/zcl_playground.clas.abap": UNIT_APP,
  "unit-tests/zcl_playground.clas.testclasses.abap": UNIT_TESTS,
  "navigation/zcl_playground.clas.abap": NAV_HUB,
  "navigation/zcl_detail.clas.abap": NAV_DETAIL,
  "fix-abaplint/zcl_playground.clas.abap": FIX_ABAPLINT,
  "fix-abap2ui5/zcl_playground.clas.abap": FIX_ABAP2UI5,
};

// The file's own name is what the editor opens it under - the directory in
// src/samples/ is only there so every sample can have its own
// zcl_playground.clas.abap and still be a file with the name its class asks
// for.
const nameOf = (file) => file.slice(file.lastIndexOf("/") + 1);

export const SAMPLES = SAMPLE_LIST.map((sample) => {
  for (const file of sample.files) {
    if (SOURCES[file] === undefined) throw new Error(`${file} is in the sample list and has no source`);
  }
  return {
    ...sample,
    // Where the sample's first file lives in this repository: the app, and
    // what a row in the samples browser links to.
    path: samplePath(sample.files[0]),
    files: sample.files.map((file) => ({ name: nameOf(file), source: SOURCES[file] })),
  };
});

export const DEFAULT_SAMPLE = SAMPLES[0];
export const DEFAULT_FILES = DEFAULT_SAMPLE.files;

export const sampleById = (id) => SAMPLES.find((s) => s.id === id);

// Is this file set exactly one of the samples, character for character?
//
// What remember( ) asks before it stores a draft. A sample somebody picked and
// read is not work to continue, and keeping it as a draft pinned that visitor
// to a frozen copy of it: the sample was improved in a later deploy and they
// went on being handed the old one - findings and all - labelled as their own
// last session. The same rule the checker settings follow, for the same
// reason, and one keystroke makes it a draft again.
export const isSample = (files) =>
  SAMPLES.some(
    (s) =>
      s.files.length === files.length &&
      s.files.every((f, i) => f.name === files[i].name && f.source === files[i].source),
  );
