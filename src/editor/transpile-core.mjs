// ABAP in the editor to JavaScript the runtime can execute.
//
// The transpiler compiles a whole registry, and this registry holds the entire
// abap2UI5 corpus - a thousand objects, twenty seconds. But the framework has
// already been compiled, at build time, and is running; the only things that
// have to be compiled here are the files in the editor.
//
// So the transpiler is handed a view of the registry in which those are the only
// objects there are. Everything else it asks for - resolving a type, looking up
// an interface - goes through to the real registry, because a proxy forwards
// what it does not intercept. What changes is only which objects it walks, which
// takes the run from twenty seconds to a few dozen milliseconds.
//
// The one subtlety is `this`. Registry methods that iterate objects (setConfig
// marking them dirty, findIssues checking them) are called with the proxy as
// their receiver, so they iterate the filtered list too. That is what keeps a
// compile from marking the whole corpus dirty and forcing a reparse.
import { Transpiler } from "@abaplint/transpiler";
import { entryClass, getRegistry, hasEntryClass, updateFiles, userObjects } from "./registry-core.mjs";

// Runs in the registry worker, beside the registry it compiles against; the
// page reaches it through compile( ) in src/editor/registry.mjs. The
// transpiler is bundled statically here: it is off the page's thread now,
// and the worker's bundle downloads beside the page's rather than after it.

function onlyTheUsersObjects(reg) {
  const objects = userObjects();
  return new Proxy(reg, {
    get(target, prop, receiver) {
      if (prop === "getObjects") return () => objects;
      if (prop === "getObjectCount") return () => ({ total: objects.length });
      return Reflect.get(target, prop, receiver);
    },
  });
}

// Compiles the editor's files and returns the JavaScript for each object, in an
// order the runtime can define them in. Rejects with a readable message when the
// transpiler cannot handle what was written - that is the honest answer to "this
// ABAP is valid but the playground cannot run it".
export async function compile(files) {
  updateFiles(files);
  const reg = getRegistry();

  const entry = entryClass(files);
  if (!hasEntryClass(files)) {
    throw new Error(
      `The playground starts the class in the first file, and ${files[0]?.name} does not declare one ` +
        `it could build${entry ? ` (it says ${entry})` : ""}.`,
    );
  }

  // The transpiler restores nothing it changes: it replaces the registry's
  // configuration with its own (a different ABAP release, and unknown types
  // voided) and leaves it there. The editor needs its own configuration back,
  // or every check after the first compile would be answered under the
  // transpiler's rules. Setting it through the proxy is what keeps the restore
  // from dirtying the entire corpus.
  const view = onlyTheUsersObjects(reg);
  const editorConfig = reg.getConfig();

  let output;
  try {
    output = await new Transpiler({
      // The editor has already run the syntax check, with better rules and
      // better messages; running it again here would only turn a marked line
      // into an exception.
      ignoreSyntaxCheck: true,
      addFilenames: false,
      addCommonJS: false,
      // Matches how the framework itself was built: a name the transpiler
      // cannot resolve becomes an error when the code runs, not when it
      // compiles.
      unknownTypes: "runtimeError",
      keywords: ["return", "in", "class", "for", "delete", "var", "with"],
    }).run(view);
  } catch (e) {
    const error = new Error(transpilerMessage(e));
    // The same lines, structured, for the editor to underline - see
    // reportTranspilerProblems( ) in editor.mjs.
    error.problems = transpilerProblems(e);
    throw error;
  } finally {
    view.setConfig(editorConfig);
    reg.parse();
  }

  const chunks = ordered(output.objects.filter((o) => o.chunk)).map((o) => {
    const before = prologue(o);
    return {
      object: o.object.name,
      // The chunk's name, for the stack a runtime error carries: the
      // runtime evaluates each chunk under it (a sourceURL), so a frame
      // says zcl_x.clas.mjs:LINE rather than <anonymous>:LINE, and LINE can
      // be looked up in `lines` - see locate( ) in src/runtime/index.mjs.
      name: baseName(o.filename),
      js: before + o.chunk.getCode(),
      lines: lineTable(o.chunk, before),
    };
  });

  if (!chunks.some((c) => c.object === entry)) {
    throw new Error(`The transpiler produced no JavaScript for ${entry}.`);
  }
  return { chunks, tests: listTests() };
}

// The unit tests among the user's files: every local class FOR TESTING in a
// test include, with its methods FOR TESTING - read off abaplint's own
// picture of the files, the same one the transpiler's runner script reads.
// The runtime's kernel_unit_runner takes exactly these three names per test
// (see runUnitTests( ) in src/runtime/index.mjs).
function listTests() {
  const tests = [];
  for (const obj of userObjects()) {
    if (obj.getType() !== "CLAS") continue;
    for (const file of obj.getABAPFiles()) {
      if (!file.getFilename().includes(".testclasses.")) continue;
      for (const def of file.getInfo().listClassDefinitions()) {
        if (!def.isForTesting || def.isGlobal || def.isAbstract) continue;
        const methods = def.methods.filter((m) => m.isForTesting).map((m) => m.name.toUpperCase());
        if (methods.length === 0) continue;
        tests.push({
          class: obj.getName(),
          testclass: def.name.toUpperCase(),
          file: file.getFilename().replace(/^.*\//, ""),
          methods,
        });
      }
    }
  }
  return tests;
}

// Each chunk runs in a scope of its own (see defineClasses), and almost every
// reference it makes goes through abap.Classes at call time - except the one
// the language resolves at definition time: the superclass. `class zcl_child
// extends zcl_base` names it bare, and the transpiler records exactly these
// names in `requires`. So they are bound at the top of the chunk, from where
// the runtime keeps every class - the framework's from the bundle, the user's
// from the chunk that ran just before this one.
function prologue(o) {
  const own = o.object.name.toUpperCase();
  const lines = [];
  for (const name of new Set(o.requires.map((r) => r.name))) {
    if (name.toUpperCase() === own) continue;
    lines.push(
      `const ${name} = abap.Classes[${JSON.stringify(name.toUpperCase())}];`,
      // Without this, a missing superclass surfaces as "Class extends value
      // undefined is not a constructor", which names neither class.
      `if (${name} === undefined) throw new Error(${JSON.stringify(`${own} needs ${name.toUpperCase()}, which the runtime does not have.`)});`,
    );
  }
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

// Definition order. Interfaces first - a class reads its interfaces' constants
// off abap.Classes while it is being defined - and a superclass before every
// class that extends it, because the prologue binds whatever is in abap.Classes
// at that moment. `requires` gives the superclass edges; inheritance cannot be
// cyclic, but if the transpiler ever hands back something that is, the rest is
// appended as-is rather than dropped.
function ordered(objects) {
  const pending = [...objects].sort((a, b) => rank(a) - rank(b));
  const placed = new Set();
  const inBatch = new Set(pending.map((o) => o.object.name.toUpperCase()));
  const result = [];
  while (pending.length > 0) {
    const i = pending.findIndex((o) =>
      o.requires.every((r) => {
        const name = r.name.toUpperCase();
        return !inBatch.has(name) || placed.has(name) || name === o.object.name.toUpperCase();
      }),
    );
    const next = i === -1 ? pending.shift() : pending.splice(i, 1)[0];
    placed.add(next.object.name.toUpperCase());
    result.push(next);
  }
  return result;
}

// Interfaces, then classes, then test includes - a test include reaches for
// its class through abap.Classes at call time, but it reads better defined
// after the thing it tests, and its prologue never binds it (same object).
const rank = (o) => (o.object.type === "INTF" ? 0 : String(o.filename).includes(".testclasses.") ? 2 : 1);

const baseName = (uri) => String(uri).replace(/^.*\//, "");

// Which ABAP line each line of JavaScript came from, as the transpiler
// recorded it while writing the chunk (its source map, without the map):
// one entry per generated line, [generatedLine, file, abapLine], ascending,
// the prologue's lines counted in. A runtime error's stack names a
// generated line, and this is how it becomes a line in the editor.
function lineTable(chunk, before) {
  const offset = before === "" ? 0 : before.split("\n").length - 1;
  const seen = new Set();
  const table = [];
  for (const m of chunk.mappings ?? []) {
    const generated = m.generated.line + offset;
    if (seen.has(generated)) continue;
    seen.add(generated);
    table.push([generated, baseName(m.source), m.original.line]);
  }
  return table.sort((a, b) => a[0] - b[0]);
}

// Transpiler errors arrive as one string with a line per problem, each of them
// "rule, message, file:row". The file name in it is a uri; the reader knows the
// file by its plain name.
// The lines that name a file and a row, as problems the editor can point at.
// A line without one - a rule that speaks about the whole object - stays in
// the log text alone.
function transpilerProblems(e) {
  const out = [];
  for (const line of String(e?.message ?? e).split("\n")) {
    const match = /^(.*), file:\/\/\/([^:]+):(\d+)$/.exec(line);
    if (match) out.push({ file: match[2], line: Number(match[3]), message: match[1] });
  }
  return out;
}

function transpilerMessage(e) {
  const raw = String(e?.message ?? e);
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/, file:\/\/\/([^:]+):(\d+)$/, " ($1 line $2)"))
    .filter(Boolean);
  return `The transpiler cannot compile this:\n${lines.join("\n")}`;
}
