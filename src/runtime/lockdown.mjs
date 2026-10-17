// What the runtime worker gives up before any code of the reader's runs in it.
//
// The worker evaluates the transpiled ABAP of whatever the editor holds - a
// share link's, a ?src= link's, a gist's - and `WRITE '@KERNEL …'` puts
// plain JavaScript into it. The worker is the site's own origin. It has no
// DOM, no localStorage and none of the page's memory (the page sends it
// roundtrips and classes, never a key), but it did have the origin's
// CacheStorage and IndexedDB - and the service worker answers from that
// cache (src/shell/sw.js). Code from a link could put a script of its own
// into it under the name of the page's bundle, and the NEXT visit - the AI
// Studio's or the Pilot's, where the reader types an API key - ran it. A
// nested Worker would have been a fresh global with both of them back.
//
// So, before index.mjs is evaluated (worker.mjs imports this first), they
// are taken off the worker: deleted wherever the global's prototype chain
// defines them, and pinned on the global itself as undefined, read-only and
// not configurable - no later code can define them again, and the browser's
// own accessors are gone with the properties, so there is nothing left to
// call them through. Nothing the runtime runs needs them: sql.js keeps its
// database in memory and fetches its WebAssembly, and neither the
// transpiled framework nor open-abap names any of these (checked against
// dist/runtime/framework.mjs).
//
// `fetch` stays: the runtime loads SQLite with it. It can reach the
// network, as any page on the web can, but not this origin's storage.
// `navigator.storage` (the origin-private file system) stays as well:
// nothing on this site reads it, so nothing written there is ever run.
export const LOCKED = ["caches", "indexedDB", "Worker", "SharedWorker"];

export function lockDown(global = globalThis) {
  for (let o = global; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const name of LOCKED) {
      if (Object.prototype.hasOwnProperty.call(o, name)) delete o[name];
    }
  }
  for (const name of LOCKED) {
    Object.defineProperty(global, name, { value: undefined, writable: false, configurable: false, enumerable: false });
  }
  // The service worker's handle, where a worker's navigator has one: the
  // worker cannot register one, but it should not reach the registration.
  const nav = global.navigator;
  for (let o = nav; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    if (Object.prototype.hasOwnProperty.call(o, "serviceWorker")) delete o.serviceWorker;
  }
}

if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) lockDown(self);
