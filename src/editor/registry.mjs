// The page's side of the abaplint registry, which lives in a worker.
//
// src/editor/registry-worker.mjs is the other half: abaplint, the corpus and
// the transpiler, on a thread of their own, so the corpus parse - the largest
// single cost of the boot - runs beside Monaco's start rather than in front
// of it, and so the page never freezes for the global type pass that abaplint
// runs synchronously at the end of it (half a second on a desk, several on a
// phone). What comes back through here has the shape the old registry module
// had, with a promise in front of everything that has to cross the thread.
//
// The worker is started by an inline script in index.html, before the shell
// bundle has arrived, the same way the ABAP runtime's is - and picked up here
// by name, with what it said before this module was listening replayed from
// the buffer that script keeps (see src/shell/runtime-client.mjs, which
// explains why). Started here as a fallback for a page without that script.
import { parseName } from "./files.mjs";

const SCRIPT = "editor/registry.mjs";

// v750 is the release abap2UI5 lints itself against, so the playground holds
// the user to the same bar - and the transpiler accepts everything up to it.
const RELEASE = "v750";

// Which rules run. Deliberately only the ones that answer "would this work",
// not the ones that answer "is this the house style" - a playground that
// underlines a missing pragma teaches nothing. registry-core.mjs has the
// story of the one rule that had to come off this list.
const RULES = {
  check_syntax: true,
  parser_error: true,
  implement_methods: true,
  method_implemented_twice: true,
  global_class: true,
  begin_end_names: true,
  superclass_final: true,
  unknown_types: true,
};

// What the Config tab shows and edits. The page holds the settings; the
// worker is told them when the registry is built and when they change.
let settings = { version: RELEASE, rules: { ...RULES } };

export const abaplintSettings = () => JSON.parse(JSON.stringify(settings));
export const abaplintDefaults = () => ({ version: RELEASE, rules: { ...RULES } });

// What the worker told the page once the corpus was parsed: every rule
// abaplint has (for the Config tab, and for validating a setting here), the
// corpus's class and interface names (for completion), the semantic tokens
// legend (for the provider that has to answer it synchronously).
let ruleNames = [];
let corpusNames = [];
let legend = { tokenTypes: [], tokenModifiers: [] };

export const allRuleNames = () => ruleNames;
export const semanticTokensLegend = () => legend;

// What a settings object has to be to be usable. The shape is checked here;
// whether every rule exists is checked here too once the worker has said
// which do, and by the worker before that - a stored setting that names a
// retired rule is caught at build and dropped (see buildRegistry below).
function validated(next) {
  if (!/^v\d{3}$|^open-abap$|^cloud$/.test(next?.version ?? "")) {
    throw new Error(`${next?.version} is not an ABAP release abaplint knows.`);
  }
  if (next?.rules === null || typeof next?.rules !== "object") {
    throw new Error("rules has to be an object of rule names.");
  }
  if (ruleNames.length > 0) {
    const unknown = Object.keys(next.rules).filter((r) => !ruleNames.includes(r));
    if (unknown.length > 0) throw new Error(`abaplint has no rule called ${unknown.join(", ")}.`);
  }
  return { version: next.version, rules: { ...next.rules } };
}

export function useAbaplintSettings(next) {
  settings = validated(next);
}

// Told when a stored setting turned out to name a rule abaplint no longer
// has - which only the worker can know, at build - so the page can forget it.
let settingsRejected = () => {};
export const onAbaplintSettingsRejected = (fn) => {
  settingsRejected = fn;
};

// ------------------------------------------------------------------ worker

let worker;
// Set once the worker has failed for good - a script that could not be
// loaded, a bundle that threw while starting - so every call after that
// rejects at once instead of being posted to a worker that will never
// answer. The failure can arrive before anything has been asked (it is
// replayed from the inline script's buffer), which is why it has to be kept.
let dead;
const pending = new Map();
let next = 0;
let onProgress = () => {};
let resolveCorpus;
let rejectCorpus;
// Resolves when the worker has the corpus JSON - the moment the page uses to
// start what should ride in the parse's idle stretch.
export const corpusLanded = new Promise((resolve, reject) => {
  resolveCorpus = resolve;
  rejectCorpus = reject;
});

export function startRegistry() {
  if (worker) return;
  worker = window.__abap2ui5Registry ?? new Worker(new URL(SCRIPT, document.baseURI), { type: "module" });

  const onMessage = (message) => {
    switch (message?.type) {
      case "corpus":
        resolveCorpus();
        return;
      case "progress":
        onProgress(message.done, message.total);
        return;
      case "failed":
        dead = revive(message.error);
        failAll(dead);
        rejectCorpus(dead);
        return;
      default:
    }
    const call = pending.get(message?.id);
    if (call === undefined) return;
    pending.delete(message.id);
    if (message.ok) call.resolve(message.value);
    else call.reject(revive(message.error));
  };
  const onError = (text) => {
    const error = new Error(text ? text.replace(/^Uncaught /, "") : `the registry worker (${SCRIPT}) could not be started`);
    dead = error;
    failAll(error);
    rejectCorpus(error);
  };
  worker.addEventListener("message", (event) => onMessage(event.data));
  worker.addEventListener("error", (event) => onError(event.message));
  for (const kept of worker.early ?? []) {
    if ("error" in kept) onError(kept.error);
    else onMessage(kept.data);
  }
  worker.early = undefined;

  // A worker whose script could not be fetched is silent in Chromium - no
  // error event for a module worker - and this one's first word, "corpus",
  // comes after a download of its own. So after a while without it the
  // script is asked for by HEAD, and only an answer other than 200 is taken
  // as the failure the browser did not report; a slow network keeps waiting.
  let landed = false;
  corpusLanded.then(() => (landed = true), () => (landed = true));
  setTimeout(async () => {
    if (landed) return;
    try {
      const response = await fetch(new URL(SCRIPT, document.baseURI), { method: "HEAD" });
      if (!landed && !response.ok) onError(`${SCRIPT}: ${response.status}`);
    } catch {
      // No answer at all is a network that is down or slow, and the worker's
      // own fetch will say which.
    }
  }, 10000);
}

function failAll(error) {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
}

function call(op, ...args) {
  startRegistry();
  if (dead) return Promise.reject(dead);
  return new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, args });
  });
}

function revive(described) {
  const error = new Error(described?.message ?? "the registry worker failed");
  if (described?.name) error.name = described.name;
  if (described?.stack) error.stack = described.stack;
  if (described?.problems) error.problems = described.problems;
  return error;
}

// ------------------------------------------------------------------- build

// Parses the corpus in the worker, under the settings the page holds, and
// hands the editor's files over when they arrive. `onProgress(done, total)`
// is relayed from the worker as the parse goes.
//
// A stored setting that names a rule abaplint no longer has fails the build
// once - then the page is told, the defaults go in, and the build runs
// again, which is the same "silently dropped" the Config tab promises.
export async function buildRegistry(filesReady, progress) {
  onProgress = progress ?? (() => {});
  filesReady.then((files) => call("files", files));
  let told;
  try {
    told = await call("build", { settings });
  } catch (e) {
    if (!/no rule called/.test(String(e?.message))) throw e;
    settings = abaplintDefaults();
    settingsRejected();
    told = await call("build", { settings });
  }
  ruleNames = told.rules;
  corpusNames = told.names;
  legend = told.legend;
}

// Applies an edited configuration: validated here and in the worker, then the
// startup parse over again with the same progress the corpus parse reported.
export async function applyAbaplintSettings(next, progress) {
  const checked = validated(next);
  await call("validateSettings", checked);
  onProgress = progress ?? (() => {});
  await call("applySettings", checked);
  settings = checked;
}

// ---------------------------------------------------------------- questions

// Everything abaplint has to say about what is open, per file, and how much
// of it the fixer could repair. One round trip per analysis.
export const analyse = (files) => call("analyse", files);

export const applyAbaplintFixes = (files) => call("applyFixes", files);

// Layout, over the files as they are open: abaplint's whitespace fixes and
// then its pretty printer - see formatFiles( ) in registry-core.mjs.
export const formatFiles = (files) => call("format", files);

export const documentSymbols = (fileName) => call("symbols", fileName);

// One language server call, by name, with plain LSP objects both ways.
export const languageServer = (method, params) => call("ls", method, params);

// Compiles the editor's files in the worker; rejects with an Error that
// carries `problems` when the transpiler refused something at a line.
export const compile = (files) => call("compile", files);

// Every class and interface completion can offer: the corpus's, told once,
// with the user's own merged in - read off the file names, which is where
// the object type lives for a file the editor holds.
export function knownObjectNames(fileNames) {
  const own = fileNames
    .map((n) => parseName(n))
    .filter((p) => p && (p.kind === "clas" || p.kind === "intf"))
    .map((p) => ({ name: p.object.toUpperCase(), type: p.kind.toUpperCase() }))
    .sort(byName);
  return own.length === 0 ? corpusNames : merge(own, corpusNames);
}

const byName = (a, b) => a.name.localeCompare(b.name);

function merge(left, right) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    out.push(byName(left[i], right[j]) <= 0 ? left[i++] : right[j++]);
  }
  while (i < left.length) out.push(left[i++]);
  while (j < right.length) out.push(right[j++]);
  return out;
}

// The name of the global object a source declares, if it declares one. Read
// off the text rather than out of the registry, because the interesting case
// is exactly the one where the registry refuses to build the object.
export function declaredObjectName(source) {
  return /^\s*(?:CLASS|INTERFACE)\s+([a-zA-Z_]\w*)\s+(?:DEFINITION|PUBLIC)/im.exec(source)?.[1]?.toUpperCase();
}

// The class the playground starts: the one the first file declares.
export function entryClass(files) {
  return declaredObjectName(files[0]?.source ?? "");
}
