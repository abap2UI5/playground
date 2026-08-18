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
export async function roundtrip(body) {
  const res = await globalThis.abap.Classes["ZCL_PG_BRIDGE"].post({ iv_body: body });
  const fields = res.get();
  return {
    status: fields.status_code.get(),
    reason: fields.status_reason.get(),
    body: fields.body.get(),
  };
}

// Registers a class that was transpiled after the bundle was built - the class
// the user is editing. A transpiled global class is self-contained: it reads
// `abap` off the global scope and ends by putting itself into abap.Classes, so
// running its source is all it takes. Re-running it replaces the previous
// version, which is what a second press of Run must do.
//
// Deliberately not a blob import: a blob URL module is cached by the browser
// for the lifetime of the page, so the second Run of an edited class would
// silently re-register the first version.
export function defineClass(source) {
  const define = new Function("abap", `${source}\nreturn true;`);
  define(globalThis.abap);
}

// True once the class of that name can be instantiated - used to tell "the app
// class the URL names was never transpiled" apart from "the app crashed".
export function hasClass(name) {
  return globalThis.abap.Classes[name.toUpperCase()] !== undefined;
}

export function abapVersion() {
  return globalThis.abap.Classes["Z2UI5_IF_APP"]?.version?.get?.() ?? "unknown";
}
