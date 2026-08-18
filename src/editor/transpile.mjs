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
import { entryClass, getRegistry, hasEntryClass, updateFiles, userObjects } from "./registry.mjs";

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
    throw new Error(transpilerMessage(e));
  } finally {
    view.setConfig(editorConfig);
    reg.parse();
  }

  // Interfaces before classes: a transpiled class reads its interface's
  // constants off the interface object at definition time, so an interface that
  // is defined afterwards is not there yet.
  const chunks = output.objects
    .filter((o) => o.chunk)
    .sort((a, b) => rank(a) - rank(b))
    .map((o) => ({ object: o.object.name, js: o.chunk.getCode() }));

  if (!chunks.some((c) => c.object === entry)) {
    throw new Error(`The transpiler produced no JavaScript for ${entry}.`);
  }
  return chunks;
}

const rank = (o) => (o.object.type === "INTF" ? 0 : 1);

// Transpiler errors arrive as one string with a line per problem, each of them
// "rule, message, file:row". The file name in it is a uri; the reader knows the
// file by its plain name.
function transpilerMessage(e) {
  const raw = String(e?.message ?? e);
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/, file:\/\/\/([^:]+):(\d+)$/, " ($1 line $2)"))
    .filter(Boolean);
  return `The transpiler cannot compile this:\n${lines.join("\n")}`;
}
