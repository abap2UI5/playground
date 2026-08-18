// The abaplint registry the playground thinks with.
//
// One registry holds the whole corpus - abap2UI5 and the open-abap standard
// library as dependencies, plus the files the user is editing. It answers two
// very different questions from that one parse:
//
//   - the editor's:  what is wrong with this class, what is this symbol,
//                    where is it defined  (src/editor/editor.mjs)
//   - the runner's:  what JavaScript do these classes compile to
//                    (src/editor/transpile.mjs)
//
// Parsing the corpus takes a few seconds and is done once, at startup, through
// parseAsync so the page keeps responding while it happens. Everything after
// that is incremental: only the file that changed is dirty.
import * as abaplint from "@abaplint/core";
import { MAIN_FILE, parseName, sidecarFor, uriFor } from "./files.mjs";

export { MAIN_FILE };

// v750 is the release abap2UI5 lints itself against, so the playground holds
// the user to the same bar - and the transpiler accepts everything up to it.
const RELEASE = "v750";

// Which rules run. Deliberately only the ones that answer "would this work",
// not the ones that answer "is this the house style" - a playground that
// underlines a missing pragma teaches nothing.
const RULES = {
  check_syntax: true,
  parser_error: true,
  implement_methods: true,
  method_implemented_twice: true,
  definitions_top: true,
  global_class: true,
  begin_end_names: true,
  superclass_final: true,
  unknown_types: true,
};

function config() {
  const conf = JSON.parse(JSON.stringify(abaplint.Config.getDefault().get()));
  conf.syntax.version = RELEASE;
  // "." matches everything, so an unresolvable name is an error rather than
  // being quietly treated as an object that exists somewhere else.
  conf.syntax.errorNamespace = ".";
  for (const rule of Object.keys(conf.rules)) conf.rules[rule] = false;
  Object.assign(conf.rules, RULES);
  return new abaplint.Config(JSON.stringify(conf));
}

let registry;
// The user's files as the registry currently holds them, so a change can be
// reduced to what actually differs.
let held = new Map();

function addFile(reg, file) {
  reg.addFile(new abaplint.MemoryFile(uriFor(file.name), file.source));
  const sidecar = sidecarFor(file.name);
  if (sidecar) reg.addFile(new abaplint.MemoryFile(uriFor(sidecar.name), sidecar.source));
}

function removeFile(reg, name) {
  reg.removeFile(reg.getFileByName(uriFor(name)));
  const sidecar = sidecarFor(name);
  const xml = sidecar && reg.getFileByName(uriFor(sidecar.name));
  if (xml) reg.removeFile(xml);
}

// Builds the registry and parses it. `onProgress(done, total)` is called as it
// goes and gets a chance to paint between objects, because parseAsync awaits the
// progress hook - which is the whole reason for using it over parse().
export async function buildRegistry(corpus, files, onProgress) {
  const reg = new abaplint.Registry(config());

  reg.addDependencies(
    Object.entries(corpus).map(([name, contents]) => new abaplint.MemoryFile(`/lib/${name}`, contents)),
  );
  held = new Map();
  for (const file of files) {
    addFile(reg, file);
    held.set(file.name, file.source);
  }

  let done = 0;
  let total = reg.getObjectCount().total;
  await reg.parseAsync({
    progress: {
      set(t) {
        total = t;
      },
      async tick() {
        done += 1;
        // Yield roughly twenty times a second: often enough that the page stays
        // alive, rarely enough that the yielding does not dominate the parse.
        if (done % 25 === 0) {
          onProgress?.(done, total);
          await new Promise((r) => setTimeout(r, 0));
        }
      },
      // The second half of the parse - resolving global types across the whole
      // corpus - reports through a synchronous hook, so there is nothing to
      // yield on there. It is a handful of passes, not a per-object loop.
      tickSync() {},
    },
  });
  onProgress?.(total, total);

  registry = reg;
  return reg;
}

export function getRegistry() {
  return registry;
}

// Brings the registry in line with the editor. Only what changed is touched, so
// this costs a few milliseconds however large the corpus is.
export function updateFiles(files) {
  const wanted = new Map(files.map((f) => [f.name, f.source]));

  for (const name of [...held.keys()]) {
    if (!wanted.has(name)) {
      removeFile(registry, name);
      held.delete(name);
    }
  }
  for (const [name, source] of wanted) {
    if (!held.has(name)) {
      addFile(registry, { name, source });
    } else if (held.get(name) !== source) {
      registry.updateFile(new abaplint.MemoryFile(uriFor(name), source));
    }
    held.set(name, source);
  }

  registry.parse();
}

// Everything wrong with one of the user's files, in the shape Monaco wants.
export function diagnostics(fileName) {
  return new abaplint.LanguageServer(registry).diagnostics({ uri: uriFor(fileName) });
}

// The objects the user's own files produced. Derived from the file names rather
// than from a namespace, so a class the user called z2ui5_something is still
// theirs and a framework object never is.
export function userObjects() {
  const names = new Set([...held.keys()].map((n) => parseName(n)?.object).filter(Boolean));
  return [...registry.getObjects()].filter((o) => names.has(o.getName()));
}

// The class the playground starts: the one the first file declares.
export function entryClass(files) {
  return declaredObjectName(files[0]?.source ?? "");
}

// True once that class is something the registry could build an object from -
// the one thing a run cannot do without.
export function hasEntryClass(files) {
  const name = entryClass(files);
  return name !== undefined && userObjects().some((o) => o.getName() === name && o.getType() === "CLAS");
}

// Every class and interface completion can offer. The corpus half is fixed for
// the life of the page and is read once; the user's own objects are read every
// time, because a class added a minute ago has to be offerable a minute ago.
let corpusNames;
export function knownObjectNames() {
  if (corpusNames === undefined) {
    const mine = new Set(userObjects().map((o) => o.getName()));
    corpusNames = [...registry.getObjects()]
      .filter((o) => (o.getType() === "CLAS" || o.getType() === "INTF") && !mine.has(o.getName()))
      .map((o) => ({ name: o.getName(), type: o.getType() }));
  }
  const own = userObjects()
    .filter((o) => o.getType() === "CLAS" || o.getType() === "INTF")
    .map((o) => ({ name: o.getName(), type: o.getType() }));
  return [...own, ...corpusNames].sort((a, b) => a.name.localeCompare(b.name));
}

// The name of the global object a source declares, if it declares one. Read off
// the text rather than out of the registry, because the interesting case is
// exactly the one where the registry refuses to build the object: a class whose
// name does not match its file produces "Class definition name must match
// filename", which is a true statement about a file the writer never saw.
export function declaredObjectName(source) {
  return /^\s*(?:CLASS|INTERFACE)\s+([a-zA-Z_]\w*)\s+(?:DEFINITION|PUBLIC)/im.exec(source)?.[1]?.toUpperCase();
}
