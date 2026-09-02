// The second visit, without the download.
//
// Before this page can do anything it fetches about seven megabytes over the
// wire: the shell bundle, which carries Monaco, abaplint, the transpiler and
// the abap2UI5 linter; the transpiled framework; the ABAP corpus the editor
// checks against; and SQLite as WebAssembly. None of it changes between
// deploys, and the browser's own cache is not somewhere you can leave twenty
// megabytes and expect to find it later - on a phone it is evicted early and
// often, and even when it survives, every asset still costs a revalidation
// round trip once it goes stale. A worker's cache is not evicted behind the
// site's back, and a hit in it costs no network at all.
//
// The shape is cache-first, over an allow list, in a cache named after the
// build. Each of those three carries its weight:
//
//   - cache-first, because once the bytes are local the round trips are what
//     is left to save, and a revalidation per asset is most of the wait on a
//     slow connection;
//   - an allow list, because everything else has to stay live: the catalogue
//     the examples browser reads, the ABAP a ?src= link points at, and the app
//     frame's own document, which Run gives a different query every time;
//   - named after the build, because the file names are not hashed. One cache
//     holds one build's assets and no other, so nothing can serve a shell from
//     one deploy beside a framework from the next.
//
// It deliberately does not call skipWaiting() or clients.claim(). A worker
// published by a later deploy installs quietly and takes over the next time
// the playground is opened with no tab of it still open - which is also the
// only moment its predecessor's cache can be deleted without pulling assets
// out from under a page that is still using them. The price is that the visit
// during which a deploy lands finishes on the build it started with. The
// alternative is swapping half a build under a running page, and a playground
// that changes its own framework under somebody's half-typed class is a worse
// thing to be than one that is a visit behind.
//
// Written by hand and copied to dist/ verbatim, the way src/embed is: a worker
// is its own top-level script with its own global, so there is no bundle for it
// to be part of. tools/build-site.mjs substitutes the build id below.

const BUILD = "__BUILD_ID__";
const CACHE = `abap2ui5-playground-${BUILD}`;

// A worker's scope is the directory it was served from, which is the site's own
// directory whether that is an origin root or a GitHub Pages project path. Every
// path below is relative to it, so none of this assumes where the site lives.
const BASE = new URL(self.registration.scope);

// The bundle's chunks - the transpiler and the abap2UI5 linter, split off the
// shell bundle and named with a hash - written in by tools/build-site.mjs,
// which is the only place that knows their names.
const CHUNKS = __CHUNKS__;

// What the app frame loads first, in both themes - the same list the page
// warms the HTTP cache with on a first visit (src/shell/warm-up.mjs), written
// in by the build as well. Precached so that a second visit's first Run needs
// nothing from the network either: everything else the frame asks for is
// kept as it is used, and this is the part it asks for before anything is
// on screen.
const APP_FIRST_LOAD = __APP_FIRST_LOAD__;

// The heavy, unchanging assets - the ones check-size.mjs budgets, plus the
// stylesheet that comes with the bundle. These are what a visitor waits for.
const CORE = [
  "assets/shell.mjs",
  "assets/shell.css",
  ...CHUNKS,
  "editor/corpus.json",
  "runtime/framework.mjs",
  "runtime/sql-wasm.wasm",
];

// Filled while the page that registered this worker is still open, rather than
// on the next visit. The page has just downloaded every one of these, so they
// come back out of the browser's own cache and cost almost nothing now; leaving
// the cache to fill itself on the next visit would make the visit after that
// the first fast one. A failure here is not worth refusing to install over -
// the assets that did land still serve, and the rest are fetched on use.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(
        [...CORE, ...APP_FIRST_LOAD].map(async (rel) => {
          const url = new URL(rel, BASE);
          const response = await fetch(url, { credentials: "same-origin" });
          if (response.status === 200) await cache.put(url, response);
        }),
      );
    })(),
  );
});

// Reached only once no page is being served by the worker this one replaces,
// which is what makes deleting its cache safe rather than a way to strand a
// running page half way through a build.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("abap2ui5-playground-") && name !== CACHE) await caches.delete(name);
      }
    })(),
  );
});

// What is worth keeping. Everything this says no to is served the ordinary way,
// by not answering the event at all - which matters as much as what it says yes
// to, because a playground whose examples came out of a cache would show
// yesterday's catalogue and yesterday's ABAP.
function isCacheable(url) {
  if (url.origin !== BASE.origin) return false;
  if (!url.pathname.startsWith(BASE.pathname)) return false;
  const rel = url.pathname.slice(BASE.pathname.length);

  // The app frame: the UI5 build, by a distance the largest thing on the site,
  // fetched a bundle at a time as the app reaches for it and identical on
  // every visit - and beside it the frontend's own files, its component
  // bundle, its manifest, the bridge script. Not precached - that is a hundred
  // megabytes nobody asked for - but kept as it is used. Its own document is
  // the one exception: app/index.html is what Run reloads with a new query
  // each time, and it has to stay live for the app to restart at all.
  //
  // Queries are allowed here, and only here. UI5 puts one on every
  // stylesheet it loads (?sap-ui-dist-version=1.151.0) and on the manifest
  // (?sap-language=EN), and both name something fixed for a build rather than
  // a moment - so refusing them left the two theme stylesheets, which block
  // the app's first paint, going to the network on every single Run.
  if (rel.startsWith("app/")) return rel !== "app/index.html";

  // Everywhere else a query says the URL is about a particular moment -
  // somebody's cache buster, a draft - and caching one moment is how a cache
  // fills up with things that will never be asked for again.
  if (url.search !== "") return false;
  if (CORE.includes(rel)) return true;
  // Monaco's icon font and the bundle's chunks, under the hashed names esbuild
  // gave them - the chunks are in CORE by name as well, this is for a chunk of
  // a build this worker was not written for, which is still worth keeping.
  if (/^assets\/[\w.-]+\.(ttf|mjs)$/.test(rel)) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }
  if (!isCacheable(url)) return;
  event.respondWith(serve(event));
});

async function serve(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;

  const response = await fetch(event.request);
  // Only a clean answer is worth keeping. A 404 or a redirect written in here
  // would outlive whatever produced it and be served back as though it were the
  // asset. The copy is taken before the response is handed on, because reading
  // the body is what consumes it - and the write is handed to waitUntil so the
  // browser does not stop the worker half way through it.
  if (response.status === 200) {
    event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
  }
  return response;
}
