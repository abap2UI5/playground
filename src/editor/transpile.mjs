// ABAP in the editor to JavaScript the runtime can execute.
//
// The transpiler compiles a whole registry, and this registry holds the entire
// abap2UI5 corpus - a thousand objects, twenty seconds. But the framework has
// already been compiled, at build time, and is running; the only thing that has
// to be compiled here is the one class in the editor.
//
// So the transpiler is handed a view of the registry in which that class is the
// only object there is. Everything else it asks for - resolving a type, looking
// up an interface - goes through to the real registry, because a proxy forwards
// what it does not intercept. What changes is only which objects it walks, which
// takes the run from twenty seconds to about ten milliseconds.
//
// The one subtlety is `this`. Registry methods that iterate objects
// (setConfig marking them dirty, findIssues checking them) are called with the
// proxy as their receiver, so they iterate the filtered list too. That is what
// keeps a compile from marking the whole corpus dirty and forcing a reparse.
import { Transpiler } from "@abaplint/transpiler";
import { getRegistry, updateSource, userObjects, USER_CLASS } from "./registry.mjs";

function onlyTheUsersClass(reg) {
  const objects = userObjects();
  return new Proxy(reg, {
    get(target, prop, receiver) {
      if (prop === "getObjects") return () => objects;
      if (prop === "getObjectCount") return () => ({ total: objects.length });
      return Reflect.get(target, prop, receiver);
    },
  });
}

// Compiles the source and returns the JavaScript for the class. Rejects with a
// readable message when the transpiler cannot handle what was written - that is
// the honest answer to "this ABAP is valid but the playground cannot run it".
export async function compile(source) {
  updateSource(source);
  const reg = getRegistry();

  if (userObjects().length === 0) {
    throw new Error(
      `The editor has to contain a global class called ${USER_CLASS} - that is the class the playground runs.`,
    );
  }

  // The transpiler restores nothing it changes: it replaces the registry's
  // configuration with its own (a different ABAP release, and unknown types
  // voided) and leaves it there. The editor needs its own configuration back,
  // or every check after the first compile would be answered under the
  // transpiler's rules. Setting it through the proxy is what keeps the restore
  // from dirtying the entire corpus.
  const view = onlyTheUsersClass(reg);
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

  const file = output.objects.find((o) => o.object.name === USER_CLASS);
  if (file === undefined) {
    throw new Error(`The transpiler produced no JavaScript for ${USER_CLASS}.`);
  }
  return file.chunk.getCode();
}

// Transpiler errors arrive as one string with a line per problem, each of them
// "rule, message, file:row". The file name is the playground's internal one and
// means nothing to the reader, so it is dropped and the line kept.
function transpilerMessage(e) {
  const raw = String(e?.message ?? e);
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/, file:\/\/\/[^:]+:(\d+)$/, " (line $1)"))
    .filter(Boolean);
  return `The transpiler cannot compile this class:\n${lines.join("\n")}`;
}
