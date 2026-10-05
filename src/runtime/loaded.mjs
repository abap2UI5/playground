// Said the moment the framework bundle starts evaluating - imported first by
// worker.mjs, so the module order runs it before index.mjs and everything that
// waits on (SQLite's WebAssembly, the seeding of the database).
//
// What it tells the page (src/shell/runtime-client.mjs) is that the script has
// ARRIVED. A HEAD answered 200 says only that it exists, and a runtime that was
// still downloading on a slow link was judged "loaded but never reported
// ready" - a stale copy from another build - and the site's cached copy was
// thrown away for it. Only a worker that has said this and then never says
// "ready" is that.
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.postMessage({ type: "loaded" });
}
