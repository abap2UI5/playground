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
import { parseName, sidecarFor, uriFor } from "./files.mjs";

// v750 is the release abap2UI5 lints itself against, so the playground holds
// the user to the same bar - and the transpiler accepts everything up to it.
const RELEASE = "v750";

// Which rules run. Deliberately only the ones that answer "would this work",
// not the ones that answer "is this the house style" - a playground that
// underlines a missing pragma teaches nothing.
//
// `definitions_top` used to be on this list and is the one that had to come
// off it, because it does not answer that question. It is a DOWNPORT rule:
// abap2UI5 enables it in its own abaplint.json because the framework is
// downported to 702 before it is transpiled, and 702 wants its declarations at
// the top of a routine. Nothing in the playground downports what is in the
// editor - the transpiler takes v750 as it is - so the rule was rejecting ABAP
// that compiles on every system this documentation targets. A `FIELD-SYMBOLS`
// after a `CREATE DATA` (the S-RTTI example in the documentation) is the shape
// that found it: an abaplint error stops Run, so the reader was told to fix
// code that had nothing wrong with it.
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

// What the Config tab shows and edits: the two things that decide what the
// editor complains about. Kept as a small object rather than abaplint's full
// configuration (a thousand lines of defaults, almost all of it irrelevant)
// because a settings screen nobody can read is a settings screen nobody uses.
let settings = { version: RELEASE, rules: { ...RULES } };

export const abaplintSettings = () => JSON.parse(JSON.stringify(settings));
export const abaplintDefaults = () => ({ version: RELEASE, rules: { ...RULES } });

function config() {
  const conf = JSON.parse(JSON.stringify(abaplint.Config.getDefault().get()));
  conf.syntax.version = settings.version;
  // "." matches everything, so an unresolvable name is an error rather than
  // being quietly treated as an object that exists somewhere else.
  conf.syntax.errorNamespace = ".";
  for (const rule of Object.keys(conf.rules)) conf.rules[rule] = false;
  Object.assign(conf.rules, settings.rules);
  return new abaplint.Config(JSON.stringify(conf));
}

// Every rule abaplint has, so the Config tab can say what is available instead
// of leaving the reader to guess at names.
export function allRuleNames() {
  return Object.keys(abaplint.Config.getDefault().get().rules).sort();
}

// What a settings object has to be to be usable. Throws the sentence the
// Config tab shows, because the reader typed this and is the one who can fix
// it. Shared by Apply and by the restore below - a stored setting is an edit
// somebody made earlier and gets exactly the same scrutiny, not less.
function validated(next) {
  const unknown = Object.keys(next?.rules ?? {}).filter((r) => !allRuleNames().includes(r));
  if (unknown.length > 0) {
    throw new Error(`abaplint has no rule called ${unknown.join(", ")}.`);
  }
  if (!/^v\d{3}$|^open-abap$|^cloud$/.test(next?.version ?? "")) {
    throw new Error(`${next?.version} is not an ABAP release abaplint knows.`);
  }
  return { version: next.version, rules: { ...next.rules } };
}

// Takes a configuration without doing anything about it. For the one caller
// that runs before there is a registry to reconfigure - boot, restoring what
// the Config tab was last set to, which has to happen before the corpus is
// parsed so the parse happens under those rules rather than being paid for
// twice. Throws what validated( ) throws, so a stored setting that no longer
// makes sense is the caller's to catch.
export function useAbaplintSettings(next) {
  settings = validated(next);
}

// Applies an edited configuration. Reparsing is the cost here - the rules run
// per object and changing them dirties all of them - so this is deliberately
// behind an explicit Apply rather than reacting to typing.
//
// And it is the startup parse again, every bit of it: the whole corpus, several
// seconds. Done synchronously that is several seconds of a page that does not
// scroll, does not repaint and does not answer - so it goes through the same
// yielding parse the corpus does, and reports the same progress. The settings
// are validated before anything is changed, so a rejected edit leaves the
// registry exactly as it was.
export async function applyAbaplintSettings(next, onProgress) {
  useAbaplintSettings(next);
  registry.setConfig(config());
  await parseWithYields(registry, onProgress);
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
//
// `filesReady` is a promise, not a list, and that is the point of the split
// below. The corpus is nine hundred objects and several seconds of parsing, and
// not one of them depends on what the user is about to edit. Where the files
// come from a ?src= link - the documentation's own way in - waiting for them
// first meant a network round trip to GitHub, and then a second one for the
// classes beside it, before the parse could even start. So the corpus is
// parsed against itself, and the handful of files the editor holds are added
// when they arrive and parsed incrementally, which is the same move
// updateFiles( ) makes on every keystroke and costs the same few milliseconds.
export async function buildRegistry(corpus, filesReady, onProgress) {
  const reg = new abaplint.Registry(config());

  reg.addDependencies(
    Object.entries(corpus).map(([name, contents]) => new abaplint.MemoryFile(`/lib/${name}`, contents)),
  );

  await parseWithYields(reg, onProgress);

  held = new Map();
  for (const file of await filesReady) {
    addFile(reg, file);
    held.set(file.name, file.source);
  }
  // Only the files just added are dirty, so this is the incremental parse and
  // not the whole corpus again.
  reg.parse();

  registry = reg;
  return reg;
}

// A yield that hands the browser a frame and comes back on the next task.
//
// setTimeout is the obvious way to write this and the wrong one: a timer set
// from inside a timer's own callback is clamped to four milliseconds, and at a
// yield per frame that is a fifth of the parse spent waiting on the clock
// rather than parsing. scheduler.yield() was the next answer and is wrong in
// a quieter way: its continuation is scheduled ahead of ordinary tasks, so a
// parse yielding through it paints and answers input but starves everything
// else on the queue for its whole duration - the ABAP runtime's "ready"
// message from its worker, the evaluation of the bundle's chunks as they
// land - and all of that then happens in a lump after the parse, which is
// exactly where the page is next waiting on it. A message posted to
// ourselves has no timer behind it either, and it takes its turn: whatever
// was queued before it runs first.
const yieldToBrowser = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

// Parses a registry without taking the page down with it, reporting progress as
// it goes. Both callers need this: the corpus at startup, and a changed rule
// set afterwards - which dirties every object and so costs the same again.
async function parseWithYields(reg, onProgress) {
  let done = 0;
  let total = reg.getObjectCount().total;
  // Yielded on a clock rather than on a count of objects. Objects are nothing
  // like equal - a large class costs many times what an interface does - so
  // every-n-objects yields far too rarely on a slow machine, which is the one
  // where it matters, and far too often on a fast one, where the yield is the
  // expensive part. A frame is the unit the answer is wanted in: long enough
  // that yielding cannot dominate the parse, short enough that the page never
  // misses one.
  let lastYield = performance.now();
  await reg.parseAsync({
    progress: {
      set(t) {
        total = t;
      },
      async tick() {
        done += 1;
        if (performance.now() - lastYield < 16) return;
        onProgress?.(done, total);
        await yieldToBrowser();
        lastYield = performance.now();
      },
      // The second half of the parse - resolving global types across the whole
      // corpus - reports through a synchronous hook, so there is nothing to
      // yield on there. It is a handful of passes, not a per-object loop.
      tickSync() {},
    },
  });
  onProgress?.(total, total);
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

// Autofix, the way `abaplint --fix` does it: ask every issue for its fix, apply
// them together, and go round again, because one fix can uncover the next. The
// registry is the thing edited, so the caller reads the new sources back out of
// it - which is also why this cannot skip the parse between passes.
//
// Bounded: a rule whose fix does not settle would otherwise spin here. Ten
// passes is far past what a single class needs (the framework downport, over
// nine hundred files, takes 106) and stops a bug from becoming a hang.
export function applyAbaplintFixes(files) {
  updateFiles(files);
  let touched = 0;
  for (let pass = 0; pass < 10; pass++) {
    const edits = registry
      .findIssues()
      .filter((i) => held.has(nameOf(i.getFilename())))
      .map((i) => i.getDefaultFix())
      .filter(Boolean);
    if (edits.length === 0) break;
    abaplint.Edits.applyEditList(registry, edits);
    registry.parse();
    touched += edits.length;
  }
  if (touched === 0) return { fixed: 0, files: [] };

  const out = [];
  for (const file of files) {
    const source = registry.getFileByName(uriFor(file.name))?.getRaw();
    if (source !== undefined && source !== file.source) out.push({ name: file.name, source });
    // The registry now holds the fixed text; `held` has to agree, or the next
    // updateFiles( ) would see the editor's old text as a change and write it
    // straight back over the fix.
    if (source !== undefined) held.set(file.name, source);
  }
  return { fixed: touched, files: out };
}

// How many of the issues in the user's files carry a fix. Asked before the
// button is offered: a Fix button that does nothing when pressed is worse than
// no button at all.
export function abaplintFixable() {
  return registry
    .findIssues()
    .filter((i) => held.has(nameOf(i.getFilename())) && i.getDefaultFix() !== undefined).length;
}

// abaplint reports a file by its uri; the playground knows it by its name.
const nameOf = (uri) => String(uri).replace(/^file:\/\/\//, "");

// What one file declares, as a tree: the class, its methods, its attributes.
// Answered by the same registry that answers diagnostics, so the outline can
// never disagree with the underlines beside it.
export function documentSymbols(fileName) {
  // Note the shape: diagnostics( ) takes { uri }, documentSymbol( ) takes
  // { textDocument: { uri } }. Passing the first shape to the second throws
  // inside abaplint rather than returning nothing, which is easy to mistake
  // for "this file has no symbols".
  return new abaplint.LanguageServer(registry).documentSymbol({ textDocument: { uri: uriFor(fileName) } });
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
//
// Kept sorted rather than sorted on the way out. There are several thousand
// names in the corpus and this is asked on a keystroke, from inside Monaco's
// completion provider - so a localeCompare sort of the whole list per
// character typed was the expensive half of offering a suggestion. The corpus
// half is sorted once; the user's handful is merged into it, which is a walk
// rather than a sort.
let corpusNames;
export function knownObjectNames() {
  if (corpusNames === undefined) {
    const mine = new Set(userObjects().map((o) => o.getName()));
    corpusNames = [...registry.getObjects()]
      .filter((o) => (o.getType() === "CLAS" || o.getType() === "INTF") && !mine.has(o.getName()))
      .map((o) => ({ name: o.getName(), type: o.getType() }))
      .sort(byName);
  }
  const own = userObjects()
    .filter((o) => o.getType() === "CLAS" || o.getType() === "INTF")
    .map((o) => ({ name: o.getName(), type: o.getType() }))
    .sort(byName);
  return merge(own, corpusNames);
}

const byName = (a, b) => a.name.localeCompare(b.name);

// Two sorted lists into one. The right-hand list is thousands of names that
// were sorted once; the left is the two or three the user has open.
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

// The name of the global object a source declares, if it declares one. Read off
// the text rather than out of the registry, because the interesting case is
// exactly the one where the registry refuses to build the object: a class whose
// name does not match its file produces "Class definition name must match
// filename", which is a true statement about a file the writer never saw.
export function declaredObjectName(source) {
  return /^\s*(?:CLASS|INTERFACE)\s+([a-zA-Z_]\w*)\s+(?:DEFINITION|PUBLIC)/im.exec(source)?.[1]?.toUpperCase();
}
