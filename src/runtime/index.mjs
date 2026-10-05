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
  const inputOf = (test) => {
    const input = new abap.types.Table(row(), { withHeader: false, type: "STANDARD", isUnique: false, keyFields: [] });
    for (const method of test.methods) {
      const line = row();
      line.get().class_name.set(test.class);
      line.get().testclass_name.set(test.testclass);
      line.get().method_name.set(method);
      abap.statements.append({ source: line, target: input });
    }
    return input;
  };
  // The runner keeps the SECOND GET RUN TIME of each test, which counts from
  // the first one ever taken in this runtime - so every duration in the Tests
  // tab included all the runs before it, and grew with the session. Started
  // afresh for this run, the values count from its start, and each test's
  // own time is the step from the row before.
  abap.context.runTime = undefined;
  const text = (field) => String(field?.get?.() ?? "").trimEnd();
  // One test class at a time. The runner calls class_setup and setup outside
  // its own TRY, so an assertion in one class's setup threw out of the whole
  // run: every test of every class came back failed, with an empty message.
  // Now that class's tests are its rows, marked with what its setup said, and
  // the other classes run as usual.
  const entries = [];
  try {
    for (const test of tests) {
      try {
        const result = await runner.run({ it_input: inputOf(test) });
        entries.push(...result.get().list.array().map((entry) => ({ entry })));
      } catch (e) {
        const said = text(e?.msg) || String(e?.message ?? "") || e?.constructor?.INTERNAL_NAME || "the setup failed";
        for (const method of test.methods) {
          entries.push({
            failed: {
              class: test.class,
              testclass: test.testclass,
              method,
              passed: false,
              status: "ERROR",
              expected: text(e?.expected),
              actual: text(e?.actual),
              message: `setup failed: ${said}`,
              microseconds: 0,
              frame: "",
              location: locate(e?.stack),
            },
          });
        }
      }
    }
  } finally {
    // The tests ran against the same class objects the app is about to use,
    // and a static attribute one of them set was what the app started with.
    // Defined again, the app starts from the classes as written (a few ms).
    if (lastChunks) await defineClasses(lastChunks);
  }
  let before = 0;
  return entries
    .map(({ entry, failed }) => {
      if (failed) return failed;
      const fields = entry.get();
      const status = text(fields.status);
      const at = Number(fields.runtime?.get?.() ?? 0);
      const microseconds = Math.max(0, at - before);
      before = at;
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
        microseconds,
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

// An ASYNC function, not a plain one: a class with a class_constructor is
// emitted with a top-level `await abap.Classes[...].class_constructor()` at
// the end of its chunk, and inside `new Function` that was a SyntaxError -
// such a class could never run. The header is two lines either way, so the
// arithmetic in locate( ) still holds.
const AsyncFunction = (async () => {}).constructor;

// The last set defined, for runUnitTests( ) to define again after the tests.
let lastChunks;

// What the previous set of chunks put into abap.Classes over the bundle's own
// entries: name -> the bundle's class there (undefined for a name the bundle
// does not have). Put back before the next set is defined. Defining only ever
// added: a file named after a framework class replaced that class for the
// rest of the session, and a broken copy (from ?src= or the AI chat) broke
// every later Run until a reload, as a class taken out of the editor stayed
// reachable by dynamic name.
const shadowed = new Map();

export async function defineClasses(chunks) {
  lastChunks = chunks;
  const classes = globalThis.abap.Classes;
  for (const [name, original] of shadowed) {
    if (original === undefined) delete classes[name];
    else classes[name] = original;
  }
  shadowed.clear();
  const before = { ...classes };
  // Only the chunks of THIS set keep a line table: every class name ever
  // defined used to keep one for the session, and locate( ) builds its
  // pattern over all of them on every dump - a catalogue session or an AI
  // chat inventing names grew both without bound.
  const names = new Set(chunks.map((c) => (typeof c === "string" ? undefined : c.name)).filter(Boolean));
  for (const name of [...lineTables.keys()]) if (!names.has(name)) lineTables.delete(name);
  try {
    for (const chunk of chunks) {
      const { js, name, lines } = typeof chunk === "string" ? { js: chunk } : chunk;
      if (name) lineTables.set(name, lines ?? []);
      const define = new AsyncFunction("abap", `${js}\nreturn true;${name ? `\n//# sourceURL=${name}` : ""}`);
      await define(globalThis.abap);
    }
  } finally {
    for (const name of Object.keys(classes)) {
      if (classes[name] !== before[name]) shadowed.set(name, before[name]);
    }
    // Even when a chunk threw: the ones before it are already redefined, and
    // the app still in the frame must not go on reading type caches built
    // from their previous versions.
    forgetCachedTypeInformation();
  }
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
      // ...and the two class-level lookups abap2UI5 keeps by class name without
      // calling them caches (z2ui5_cl_ui5_util_context): a class refused once
      // as "does not implement z2ui5_if_app" stayed refused after the reader
      // added the interface, until a reload.
      if (/cache|^gt_class_(exists|impl_intf)$/i.test(name)) value?.clear?.();
    }
  }
}

// The framework version, read where the framework itself keeps it. Interface
// constants are transpiled onto the interface object under their fully
// qualified name, which is why this is not simply `.version`.
export function abapVersion() {
  return globalThis.abap.Classes["Z2UI5_IF_APP"]?.["z2ui5_if_app$version"]?.get() ?? "unknown";
}
