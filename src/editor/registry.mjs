// The abaplint registry the playground thinks with.
//
// One registry holds the whole corpus - abap2UI5 and the open-abap standard
// library as dependencies, plus the single class the user is editing. It answers
// two very different questions from that one parse:
//
//   - the editor's:  what is wrong with this class, what is this symbol,
//                    where is it defined  (src/editor/editor.mjs)
//   - the runner's:  what JavaScript does this class compile to
//                    (src/editor/transpile.mjs)
//
// Parsing the corpus takes a few seconds and is done once, at startup, through
// parseAsync so the page keeps responding while it happens.
import * as abaplint from "@abaplint/core";

// The name the user's class lives under, in both the registry and Monaco. The
// two have to agree exactly: abaplint's language server looks a document up by
// its uri, and the uri it compares against is this filename.
export const USER_FILE = "file:///zcl_playground.clas.abap";
export const USER_XML = "file:///zcl_playground.clas.xml";
export const USER_CLASS = "ZCL_PLAYGROUND";

// v750 is the release abap2UI5 lints itself against, so the playground holds
// the user to the same bar - and the transpiler accepts everything up to it.
const RELEASE = "v750";

// Which rules run. Deliberately only the ones that answer "would this class
// work", not the ones that answer "is this the house style" - a playground that
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

// The abapGit metadata sidecar every global class needs. abaplint reads the
// class's name and its "class-local types" flag out of it; without one the
// object is not a class at all and nothing resolves.
const userXml = (name) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <VSEOCLASS>
    <CLSNAME>${name}</CLSNAME>
    <LANGU>E</LANGU>
    <DESCRIPT>playground</DESCRIPT>
    <STATE>1</STATE>
    <CLSCCINCL>X</CLSCCINCL>
    <FIXPT>X</FIXPT>
    <UNICODE>X</UNICODE>
   </VSEOCLASS>
  </asx:values>
 </asx:abap>
</abapGit>`;

let registry;

// Builds the registry and parses it. `onProgress(done, total)` is called as it
// goes and gets a chance to paint between objects, because parseAsync awaits the
// progress hook - which is the whole reason for using it over parse().
export async function buildRegistry(corpus, source, onProgress) {
  const reg = new abaplint.Registry(config());

  reg.addDependencies(
    Object.entries(corpus).map(([name, contents]) => new abaplint.MemoryFile(`/lib/${name}`, contents)),
  );
  reg.addFile(new abaplint.MemoryFile(USER_FILE, source));
  reg.addFile(new abaplint.MemoryFile(USER_XML, userXml(USER_CLASS)));

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

// Replaces the user's class and re-parses. Only that one object is dirty, so
// this costs a few milliseconds however large the corpus is.
export function updateSource(source) {
  registry.updateFile(new abaplint.MemoryFile(USER_FILE, source));
  registry.parse();
}

// Everything wrong with the class in the editor, in the shape Monaco wants.
export function diagnostics() {
  return new abaplint.LanguageServer(registry).diagnostics({ uri: USER_FILE });
}

// The objects the user's own file produced - one class, unless the source is so
// broken that abaplint cannot see a class in it at all.
export function userObjects() {
  return [...registry.getObjects()].filter((o) => o.getName() === USER_CLASS);
}

// Every global object the corpus defines, for name completion. Read once and
// cached: the corpus does not change while the page is open.
let objectNames;
export function knownObjectNames() {
  if (objectNames === undefined) {
    objectNames = [...registry.getObjects()]
      .filter((o) => o.getType() === "CLAS" || o.getType() === "INTF")
      .map((o) => ({ name: o.getName(), type: o.getType() }))
      .filter((o) => o.name !== USER_CLASS)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return objectNames;
}

// The name of the global class the source declares, if it declares one. Read
// off the text rather than out of the registry, because the interesting case is
// exactly the one where the registry refuses to build the object: a class under
// any other name produces "Class definition name must match filename", which is
// a true statement about a file the writer never saw.
export function declaredClassName(source) {
  return /^\s*CLASS\s+([a-zA-Z_]\w*)\s+DEFINITION/im.exec(source)?.[1]?.toUpperCase();
}
