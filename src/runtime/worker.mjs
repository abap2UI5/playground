// The framework bundle's entry point: src/runtime/index.mjs, answering over
// postMessage when it finds itself in a worker.
//
// The page runs the transpiled framework in a dedicated worker rather than on
// its own thread, and the reason is the boot. Evaluating the bundle - six
// megabytes of JavaScript defining seven hundred classes, then SQLite starting
// up and seeding the drafts database - is close to a second of processor on a
// desk and several on a phone, and on the main thread it sat in front of the
// corpus parse: the corpus had arrived long before, and abaplint could not
// start on it until the framework was done. In a worker the two run on
// different cores, and the page keeps painting through both.
//
// The surface that crosses the thread boundary is the four functions
// index.mjs exports, and nothing else: a roundtrip in, a response out; the
// JavaScript of the user's classes in; a reset; the version. All of it is
// strings and plain objects, so nothing is lost in the copy. The page's side
// is src/shell/runtime-client.mjs.
//
// Everything index.mjs exports is re-exported, so the bundle is still an
// ordinary module when imported into a page - tests/runtime.spec.js drives
// the framework that way, without UI5 or an iframe between it and the ABAP.
// Only in a worker does the message handling below switch on.
// First: says the script has arrived, before index.mjs starts its own work.
import "./loaded.mjs";
import * as runtime from "./index.mjs";

export * from "./index.mjs";

// A dump is located by the first frame of the reader's own code in its stack
// (locate( ) in index.mjs), and V8 keeps ten frames by default - a framework
// raise point a few calls deeper than usual lost the line. Fifty is cheap.
Error.stackTraceLimit = 50;

// The operations the page may ask for, by name. An allow list rather than
// `runtime[op]`, so a message can reach exactly these and not, say, a
// property of the module namespace.
const OPS = {
  roundtrip: runtime.roundtrip,
  defineClasses: runtime.defineClasses,
  resetDatabase: runtime.resetDatabase,
  abapVersion: runtime.abapVersion,
  runUnitTests: runtime.runUnitTests,
};

const inWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;

if (inWorker) {
  // ONE OPERATION AT A TIME. The handler is async, so a Run's defineClasses
  // and resetDatabase used to land in the middle of a roundtrip still under
  // way - classes redefined and caches cleared under it, the database
  // reopened beneath its SQL. Each message now waits for the one before.
  let queue = Promise.resolve();
  self.addEventListener("message", (event) => {
    queue = queue.then(() => handle(event));
  });
}

async function handle(event) {
  const { id, op, args } = event.data ?? {};
  const fn = OPS[op];
  try {
    if (fn === undefined) throw new Error(`The ABAP runtime has no operation called ${op}.`);
    const value = await fn(...(args ?? []));
    self.postMessage({ id, ok: true, value });
  } catch (e) {
    // An Error does not survive structured cloning with its name and stack
    // intact in every browser, so the three fields the page reports are
    // sent as plain strings and put back together on the other side.
    self.postMessage({
      id,
      ok: false,
      error: {
        name: e?.name,
        message: String(e?.message ?? e),
        stack: typeof e?.stack === "string" ? e.stack : "",
        // A JavaScript error out of the user's own code - a TypeError the
        // transpiled ABAP ran into - traced to its ABAP line when it can be.
        location: runtime.locate(e?.stack),
      },
    });
  }
}

if (inWorker) {
  // Sent once the framework is up - which it is, because the import above
  // awaited the transpiled init. The version travels with it so the page can
  // answer abapVersion( ) without a round trip.
  self.postMessage({ type: "ready", version: runtime.abapVersion() });
}
