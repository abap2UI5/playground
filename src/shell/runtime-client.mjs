// The page's handle on the ABAP runtime, which lives in a worker.
//
// src/runtime/worker.mjs is the other half: the transpiled framework, started
// as a dedicated worker so that evaluating it - the better part of a second
// on a desk, several on a phone - runs beside the corpus parse rather than in
// front of it. What comes back through here has the same shape the framework
// module exports (roundtrip, defineClasses, resetDatabase, abapVersion), so
// the rest of the page does not know which thread it is talking to.
//
// The worker is started by an inline script at the top of index.html, before
// the shell bundle has even arrived, and picked up here by name. That is what
// gets the framework's download and evaluation moving with the document
// instead of after the bundle that starts it has been downloaded and
// evaluated itself. Started here as a fallback, so a page without that script
// still works - only later.
//
// Being that early has one consequence: the worker can have spoken before
// this module exists to listen. A Worker dispatches "message" and "error"
// whether or not a handler is attached, so the inline script keeps what
// arrives in `worker.early`, and startRuntime( ) replays it through the same
// handlers it attaches for everything after - then switches the buffer off.
// Without that, a framework that booted out of the cache faster than the
// bundle, or a script that failed to load at all, left the page waiting for
// a runtime that had already answered.

// The worker script's URL, relative to the document rather than to this
// module, so it resolves under a GitHub Pages project path as well as at a
// site root. Kept in step with tools/build-framework.mjs, which writes it.
const SCRIPT = "runtime/framework.mjs";

export function startRuntime() {
  const worker = window.__abap2ui5Runtime ?? new Worker(new URL(SCRIPT, document.baseURI), { type: "module" });

  const pending = new Map();
  let next = 0;
  let version;
  let settled = false;

  const failAll = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  // Resolves once the worker has evaluated the framework and said so. Rejects
  // if the worker fails before that - a script that will not load, a bundle
  // that throws while booting - with whatever the browser could say about it,
  // which for a worker is an ErrorEvent rather than the exception itself.
  let fail;
  const ready = new Promise((resolve, reject) => {
    fail = (error) => {
      settled = true;
      reject(error);
      failAll(error);
    };
    const onMessage = (message) => {
      if (message?.type === "ready") {
        version = message.version;
        settled = true;
        resolve();
        return;
      }
      const call = pending.get(message?.id);
      if (call === undefined) return;
      pending.delete(message.id);
      if (message.ok) call.resolve(message.value);
      else call.reject(revive(message.error));
    };
    const onError = (text) => {
      fail(new Error(text ? text.replace(/^Uncaught /, "") : `the ABAP runtime (${SCRIPT}) could not be started`));
    };
    worker.addEventListener("message", (event) => onMessage(event.data));
    worker.addEventListener("error", (event) => onError(event.message));
    // What was said before this module was listening - see the note above.
    // Replayed after the handlers are attached, so nothing can fall between
    // the buffer and them, and then the buffer is taken away so the inline
    // script stops filling it.
    for (const kept of worker.early ?? []) {
      if ("error" in kept) onError(kept.error);
      else onMessage(kept.data);
    }
    worker.early = undefined;
  });

  // A worker whose script could not be fetched at all is silent in Chromium: a
  // module worker that answers 404 or 503 simply never exists, and no error
  // event says so (a classic worker's does). So the one moment the page has
  // been waiting on the runtime and it has not spoken - the corpus parsed,
  // nothing to do but wait - is when the script is asked for by HEAD, which
  // costs no body and goes past the service worker (it only answers GET). An
  // answer other than 200 is the failure the browser would not report; 200
  // means the framework is still evaluating, and the wait goes on. Never asked
  // earlier, because a runtime that is merely slower than the parse is the
  // normal case on a phone, and a probe there would be one more request in
  // the way of the assets the page is waiting for.
  const whenReady = async () => {
    if (!settled) {
      try {
        const response = await fetch(new URL(SCRIPT, document.baseURI), { method: "HEAD" });
        if (!settled && !response.ok) fail(new Error(`${SCRIPT}: ${response.status}`));
      } catch (e) {
        if (!settled) fail(new Error(`${SCRIPT}: ${String(e?.message ?? e)}`));
      }
    }
    return ready;
  };

  // Every call waits for the runtime to be up first, so nothing is posted to a
  // worker that has not yet installed its listener - and so a failure to start
  // is reported by the call that needed the runtime, not lost.
  const call = async (op, ...args) => {
    await whenReady();
    return new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, op, args });
    });
  };

  return {
    // Rejects the moment the worker fails; resolves when it says it is up.
    ready,
    // The same, asked for by the page that is now waiting on it - see above.
    whenReady,
    roundtrip: (body) => call("roundtrip", body),
    defineClasses: (sources) => call("defineClasses", sources),
    resetDatabase: () => call("resetDatabase"),
    // Known from the ready message, so this can stay synchronous.
    abapVersion: () => version ?? "unknown",
  };
}

// An error as the worker described it, as an Error again - name, message and
// stack, which is what describeError( ) in ui.mjs reads.
function revive(described) {
  const error = new Error(described?.message ?? "the ABAP runtime failed");
  if (described?.name) error.name = described.name;
  if (described?.stack) error.stack = described.stack;
  return error;
}
