// The samples the samples browser offers without a network, assembled.
//
// Both halves are generated: `build/samples/index.json` is what they are (id,
// title, blurb, file names, the GitHub link), and `build/samples/sources.mjs`
// is the ABAP - the default sample's files as static imports, every other
// sample's as a loader that import( )s a module of its own.
// `tools/build-site.mjs` writes all of it out of the pinned abap2UI5/samples -
// see `sample-list.mjs`, which is the only hand-written part and is nothing
// but class names.
//
// ONLY THE DEFAULT SAMPLE'S ABAP IS IN THE BUNDLE. The page opens on it; the
// other eight are 60 KB of text that every visitor downloaded and evaluated
// for a pick most never make, so each is a chunk fetched the first time it is
// asked for (loadSampleFiles) - during the parse it is nothing, and on a pick
// it is one small request the service worker has precached anyway.
//
// Node imports the index and not this module: the list is JSON on purpose, so
// the tests can read what the page carries without a bundler.
import INDEX from "../../build/samples/index.json";
import { DEFAULT_SOURCES, LOADERS } from "../../build/samples/sources.mjs";

/** What the page carries: id, title, note, group, docs, github, and `files`
 *  as NAMES. The ABAP comes through loadSampleFiles( ). */
export const SAMPLES = INDEX;

const withSources = (sample, sources) =>
  sample.files.map((name) => {
    if (sources[name] === undefined) throw new Error(`${name} is in the sample index and has no source`);
    return { name, source: sources[name] };
  });

export const DEFAULT_SAMPLE = SAMPLES[0];
export const DEFAULT_FILES = withSources(DEFAULT_SAMPLE, DEFAULT_SOURCES);

export const sampleById = (id) => SAMPLES.find((s) => s.id === id);

// The files of each sample once they have landed, and the loads under way.
const loaded = new Map([[DEFAULT_SAMPLE.id, DEFAULT_FILES]]);
const loading = new Map();

/** A sample's files, `{ name, source }` each - a promise, resolved at once
 *  for the default sample and for one asked for before; undefined for an id
 *  the page does not carry. */
export function loadSampleFiles(id) {
  if (loaded.has(id)) return Promise.resolve(loaded.get(id));
  const sample = sampleById(id);
  if (!sample) return Promise.resolve(undefined);
  if (!loading.has(id)) {
    loading.set(
      id,
      LOADERS[id]().then((sources) => {
        const files = withSources(sample, sources);
        loaded.set(id, files);
        return files;
      }),
    );
  }
  return loading.get(id);
}

/** The sample whose first file is this class, by its files - a promise - or
 *  undefined: how the AI Pilot opens a carried copy without a network. */
export function carriedSampleFiles(cls) {
  const sample = SAMPLES.find((s) => s.files[0] === `${String(cls).toLowerCase()}.clas.abap`);
  return sample ? loadSampleFiles(sample.id) : undefined;
}

// Is this file set exactly one of the samples, character for character?
//
// What remember( ) asks before it stores a draft. A sample somebody picked and
// read is not work to continue, and keeping it as a draft pinned that visitor
// to a frozen copy of it: the sample was improved in a later deploy and they
// went on being handed the old one - findings and all - labelled as their own
// last session. The same rule the checker settings follow, for the same
// reason, and one keystroke makes it a draft again.
//
// Answered from what has landed: the names decide which sample it could be,
// and a sample whose files have not been fetched yet - the page opened on a
// stored draft that was typed back into exactly one of them - is not known
// to match, so that draft is kept once more and the files are asked for, and
// the next change answers for real. A sample picked in the browser has its
// files by the time anything is typed.
export const isSample = (files) => {
  for (const sample of SAMPLES) {
    if (sample.files.length !== files.length || !sample.files.every((name, i) => name === files[i].name)) continue;
    const have = loaded.get(sample.id);
    if (!have) {
      loadSampleFiles(sample.id).catch(() => {});
      return false;
    }
    if (have.every((f, i) => f.source === files[i].source)) return true;
  }
  return false;
};
