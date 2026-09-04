// The registry worker: abaplint, the corpus and the transpiler, on a thread of
// their own.
//
// Parsing the corpus is the largest single cost between opening the page and
// an app on screen - two seconds on a desk, eight on a phone - and it used to
// run on the page's thread, yielding every frame so the page could paint, in
// front of everything else the page wanted that thread for: Monaco's own
// start, the chunks landing, the first render of the editor. Here it runs
// beside all of that. The corpus is fetched from here too, so its JSON is
// parsed off the page as well.
//
// What crosses the thread is exactly what src/editor/registry.mjs exports to
// the page, as messages: {id, op, args} in, {id, ok, value} or {id, ok: false,
// error} out, plus three the worker sends on its own - "corpus" when the JSON
// has landed, "progress" while the parse runs, "failed" when the worker could
// not get as far as being asked anything. Everything in between is plain LSP
// objects and strings, which structured cloning copies as they are.
import * as core from "./registry-core.mjs";
import { compile } from "./transpile-core.mjs";

const post = (message) => self.postMessage(message);

// Fetched the moment the worker starts - before the page has said anything,
// because nothing about the corpus depends on the page. Relative to this
// script, which is served from the same directory as the corpus.
const corpusReady = fetch(new URL("./corpus.json", self.location.href)).then((response) => {
  if (!response.ok) throw new Error(`corpus.json: ${response.status}`);
  return response.json();
});
corpusReady.then(
  () => post({ type: "corpus" }),
  (e) => post({ type: "failed", error: describe(e) }),
);

// The files the editor holds, handed over when the page knows them - which
// for a ?src= link is two round trips to GitHub later. The parse does not
// wait for them: the corpus is parsed against itself, and these are added
// incrementally afterwards (see buildRegistry in registry-core.mjs).
let resolveFiles;
const filesReady = new Promise((resolve) => {
  resolveFiles = resolve;
});

const progress = (done, total) => post({ type: "progress", done, total });

const OPS = {
  async build({ settings }) {
    if (settings) core.useAbaplintSettings(settings);
    const corpus = await corpusReady;
    await core.buildRegistry(corpus, filesReady, progress);
    return {
      rules: core.allRuleNames(),
      names: core.corpusObjectNames(),
      legend: core.semanticTokensLegend(),
    };
  },
  files(files) {
    resolveFiles(files);
  },
  // One analysis of what is open: the registry brought in line with the
  // editor, then everything abaplint has to say about each file, and how much
  // of that it could fix itself.
  analyse(files) {
    core.updateFiles(files);
    const diagnostics = {};
    for (const file of files) diagnostics[file.name] = core.diagnostics(file.name);
    return { diagnostics, fixable: core.abaplintFixable() };
  },
  applyFixes(files) {
    return core.applyAbaplintFixes(files);
  },
  format(files) {
    return core.formatFiles(files);
  },
  symbols(name) {
    return core.documentSymbols(name);
  },
  ls(method, params) {
    return core.languageServer(method, params);
  },
  compile(files) {
    return compile(files);
  },
  validateSettings(next) {
    core.validateSettings(next);
  },
  async applySettings(next) {
    await core.applyAbaplintSettings(next, progress);
  },
};

self.addEventListener("message", async (event) => {
  const { id, op, args } = event.data ?? {};
  try {
    const fn = OPS[op];
    if (fn === undefined) throw new Error(`The registry worker has no operation called ${op}.`);
    const value = await fn(...(args ?? []));
    post({ id, ok: true, value });
  } catch (e) {
    post({ id, ok: false, error: describe(e) });
  }
});

// An error as fields, because an Error does not cross the thread with its
// name and stack intact in every browser. `problems` is the transpiler's
// list of what it refused, with a file and a line each - see
// transpile-core.mjs.
function describe(e) {
  return {
    name: e?.name,
    message: String(e?.message ?? e),
    stack: typeof e?.stack === "string" ? e.stack : "",
    problems: Array.isArray(e?.problems) ? e.problems : undefined,
  };
}
