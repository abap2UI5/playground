// The playground's view of the transpiled framework.
//
// Importing this module boots abap2UI5: build/output/init.mjs creates the ABAP
// runtime, runs the database setup and loads every transpiled object, all at
// module scope. By the time the import resolves the framework is live and
// `globalThis.abap` is the runtime object the generated code talks to.
//
// Everything below is the whole surface the page uses. Deliberately small: the
// less of the ABAP object model leaks into the page, the less of it can break
// when the framework moves.
import "../../build/output/init.mjs";
import { resetDatabase } from "./db-setup.mjs";

export { resetDatabase };

// One roundtrip. Takes and returns exactly what travels over HTTP on a real
// system, so the caller does not have to know that ABAP is involved at all.
//
// Errors do not escape: the framework turns any unhandled ABAP exception into a
// 500 whose body is the dump, and that is more useful to the developer than a
// rejected promise. What can still throw is a broken runtime (a transpiled
// object missing, the database gone) - a bug, not a user error, and it should
// reach the console as one.
//
// A 500 carries, beside the dump, the ABAP line the exception was raised at
// when it can be found (locate( ) above) - which is the line the editor
// then points at.
export async function roundtrip(body) {
  lastDump = undefined;
  const res = await globalThis.abap.Classes["ZCL_PG_BRIDGE"].post({ iv_body: body });
  const fields = res.get();
  const status = fields.status_code.get();
  const answer = {
    status,
    reason: fields.status_reason.get(),
    body: fields.body.get(),
  };
  if (status >= 500 && lastDump) {
    const location = locate(lastDump.stack);
    if (location) answer.location = { ...location, exception: lastDump.name };
  }
  return answer;
}

// Runs unit tests, through the runner open-abap ships for exactly this:
// kernel_unit_runner takes a table of (class, test class, method), creates
// each test class - registered as CLAS-<class>-<local class> by the
// transpiled include - calls class_setup, setup, the method, teardown, and
// answers a row per test with its status, the assertion's expected and
// actual, the message, and the JavaScript frame the assertion was raised
// from, which locate( ) turns into the ABAP line. The same runner the
// transpiler's own test script calls; here it is fed from the editor.
export async function runUnitTests(tests) {
  const abap = globalThis.abap;
  const runner = abap.Classes["KERNEL_UNIT_RUNNER"];
  if (!runner) throw new Error("This runtime carries no unit test runner.");
  const row = () =>
    new abap.types.Structure({
      class_name: new abap.types.Character(30),
      testclass_name: new abap.types.Character(30),
      method_name: new abap.types.Character(30),
    });
  const input = new abap.types.Table(row(), { withHeader: false, type: "STANDARD", isUnique: false, keyFields: [] });
  for (const test of tests) {
    for (const method of test.methods) {
      const line = row();
      line.get().class_name.set(test.class);
      line.get().testclass_name.set(test.testclass);
      line.get().method_name.set(method);
      abap.statements.append({ source: line, target: input });
    }
  }
  const result = await runner.run({ it_input: input });
  const text = (field) => String(field?.get?.() ?? "").trimEnd();
  return result
    .get()
    .list.array()
    .map((entry) => {
      const fields = entry.get();
      const status = text(fields.status);
      return {
        class: text(fields.class_name),
        testclass: text(fields.testclass_name),
        method: text(fields.method_name),
        passed: status === "SUCCESS",
        status,
        expected: text(fields.expected),
        actual: text(fields.actual),
        message: text(fields.message),
        // Microseconds on a system; the runtime's GET RUN TIME counts them too.
        microseconds: Number(fields.runtime?.get?.() ?? 0),
        // The frame as the runner found it, and the ABAP line behind it.
        frame: text(fields.js_location),
        location: locate(text(fields.js_location)),
      };
    });
}

// Registers objects that were transpiled after the bundle was built - the
// classes the user is editing. A transpiled global object is self-contained: it
// reads `abap` off the global scope and ends by putting itself into
// abap.Classes, so running its source is all it takes. Running it again replaces
// the previous version, which is what a second press of Run must do.
//
// Deliberately not a blob import: a blob URL module is cached by the browser for
// the lifetime of the page, so the second Run of an edited class would silently
// re-register the first version.
//
// The caches are dropped once, at the end, rather than between objects - a class
// defined halfway through the batch would otherwise repopulate them from a
// half-loaded picture.
//
// Each chunk arrives with a name and its line table (transpile-core.mjs),
// and is evaluated under that name - the sourceURL comment is what makes a
// stack frame say zcl_x.clas.mjs:12 instead of <anonymous>:12 - so that a
// runtime error can be traced back to an ABAP line by locate( ) below. A
// bare string still works, for the tests that drive this without a shell;
// a chunk defined that way has no line to be traced to.
const lineTables = new Map();

export function defineClasses(chunks) {
  for (const chunk of chunks) {
    const { js, name, lines } = typeof chunk === "string" ? { js: chunk } : chunk;
    if (name) lineTables.set(name, lines ?? []);
    const define = new Function("abap", `${js}\nreturn true;${name ? `\n//# sourceURL=${name}` : ""}`);
    define(globalThis.abap);
  }
  forgetCachedTypeInformation();
}

// The ABAP line behind a JavaScript stack: the first frame that is in one of
// the user's chunks, looked up in that chunk's line table. Undefined when no
// frame is - an error inside the framework, or a chunk defined without a
// name. The two in the arithmetic is the header `new Function` puts in front
// of a body, which V8 counts.
export function locate(stack) {
  if (typeof stack !== "string" || lineTables.size === 0) return undefined;
  const names = [...lineTables.keys()].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const frame = new RegExp(`(${names}):(\\d+):\\d+`);
  for (const line of stack.split("\n")) {
    const match = frame.exec(line);
    if (!match) continue;
    const table = lineTables.get(match[1]);
    const generated = Number(match[2]) - 2;
    let found;
    for (const [at, file, abapLine] of table) {
      if (at > generated) break;
      found = { file, line: abapLine };
    }
    if (found) return found;
  }
  return undefined;
}

// The exception behind the last 500 the framework answered - see the hook
// below - with the innermost cause's stack, which is where it was raised.
let lastDump;

// The framework catches every exception an app raises and answers a 500
// whose body is the dump - the right thing for a frontend, and the end of
// the trail for a debugger: the dump names the exception and not the line.
// The exception object itself is a JavaScript Error (cx_root extends Error
// in the transpiled code) and carries the stack from where it was raised,
// so the one method the handler hands it to is wrapped to keep it. A
// handler without that method - the framework moved it - simply loses the
// line, not the roundtrip.
function keepDumpsLocatable() {
  const handler = globalThis.abap?.Classes?.["Z2UI5_CL_UI5_HTTP_HANDLER"];
  const original = handler?._error_response;
  if (typeof original !== "function") return;
  handler._error_response = async function (INPUT) {
    try {
      let cx = INPUT?.val?.get?.();
      // The framework wraps the app's exception in one of its own; the line
      // is in the innermost.
      for (let depth = 0; depth < 20; depth++) {
        const previous = cx?.previous?.get?.();
        if (!previous) break;
        cx = previous;
      }
      lastDump = cx ? { stack: cx.stack, name: cx.constructor?.INTERNAL_NAME } : undefined;
    } catch {
      lastDump = undefined;
    }
    return original.call(this, INPUT);
  };
}
keepDumpsLocatable();

// Everything the running system remembers about what a class looks like.
//
// A class name is the key to every type cache there is: open-abap's RTTI keeps
// one descriptor per name (cl_abap_objectdescr=>mt_cache), and abap2UI5 keeps
// its own for the attributes it binds to a view. Redefining a class leaves all
// of them describing the version that is gone - the app then starts, renders,
// and fails on the first binding with "No class attribute for binding found",
// naming an attribute that is right there in the source.
//
// So they are dropped, by their name rather than by a list: the framework calls
// a cache a cache, and a list of the ones that exist today is a list that goes
// stale the next time abap2UI5 adds one. A cache that is cleared for nothing
// costs a rebuild; one that is missed costs an error nobody can explain.
function forgetCachedTypeInformation() {
  for (const cls of Object.values(globalThis.abap.Classes)) {
    for (const [name, value] of Object.entries(cls)) {
      if (/cache/i.test(name)) value?.clear?.();
    }
  }
}

// The framework version, read where the framework itself keeps it. Interface
// constants are transpiled onto the interface object under their fully
// qualified name, which is why this is not simply `.version`.
export function abapVersion() {
  return globalThis.abap.Classes["Z2UI5_IF_APP"]?.["z2ui5_if_app$version"]?.get() ?? "unknown";
}
