// The samples the samples browser offers without a network, assembled.
//
// Both halves are generated: `build/samples/index.json` is what they are (id,
// title, blurb, files, the GitHub link), and `build/samples/sources.mjs` is
// the ABAP, one static import per file so a bundler can see them all.
// `tools/build-site.mjs` writes both out of the pinned abap2UI5/samples -
// see `sample-list.mjs`, which is the only hand-written part and is nothing
// but class names.
//
// Node imports the index and not this module: the list is JSON on purpose, so
// the tests can read what the page carries without a bundler.
import INDEX from "../../build/samples/index.json";
import { SOURCES } from "../../build/samples/sources.mjs";

export const SAMPLES = INDEX.map((sample) => {
  for (const file of sample.files) {
    if (SOURCES[file] === undefined) throw new Error(`${file} is in the sample index and has no source`);
  }
  return {
    ...sample,
    files: sample.files.map((file) => ({ name: file, source: SOURCES[file] })),
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
