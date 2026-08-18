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
export function defineClasses(sources) {
  for (const source of sources) {
    const define = new Function("abap", `${source}\nreturn true;`);
    define(globalThis.abap);
  }
  forgetCachedTypeInformation();
}

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
