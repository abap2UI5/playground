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
//     the examples browser reads, the ABAP a ?src= link points at, and the two
//     documents - this page's and the app frame's, which Run gives a different
//     query every time. The documents are the one exception to cache-first:
//     they go to the network first and fall back to the copy the last online
//     visit left, which is what makes the installed playground (see the
//     manifest in index.html) open and run with no network at all;
//   - named after the build, because the file names are not hashed. One cache
//     holds one build's assets and no other, so nothing can serve a shell from
//     one deploy beside a framework from the next - and because the names are
//     not hashed, the name of the cache is not enough to make that true: what
//     goes into it is checked against the build as well, see CORE below.
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
// stylesheet that comes with the bundle. These are what a visitor waits for,
// and none of them carries a hash in its name - so each is listed with the
// SHA-256 of the bytes this build wrote, and nothing goes into the cache
// under one of these names that does not hash to it. Written in by
// tools/build-site.mjs, which hashes the same files for the build id.
//
// That check is what actually keeps one build's assets in one cache. Right
// after a deploy the site is not one build from where a browser stands:
// GitHub Pages' CDN can answer index.html and the shell bundle from the new
// deploy and runtime/framework.mjs from the old one for a few minutes, and
// the browser's own HTTP cache can do the same with whatever it still holds
// under its max-age. This worker used to precache whatever it got, and a
// cache filled in that window was a shell from one build beside a framework
// from another - permanently, under the new build's name, and served
// cache-first on every visit from then on. The page then waited on a runtime
// that never spoke: the earlier framework was a page module, not a worker,
// and had nothing to say. A copy that does not hash to the build is simply
// not kept; the page runs on it once, and the next visit asks again.
const CORE_HASHES = __CORE__;
const CORE = [...Object.keys(CORE_HASHES), ...CHUNKS];

// The two documents, kept as the fallback the network-first path below
// reaches for - precached as well, so one online visit is enough for the
// installed playground to open offline, rather than the second one it would
// take for a controlled page to pass through serveDocument( ).
const DOCUMENTS = ["index.html", "app/index.html"];

async function matchesBuild(rel, response) {
  const expected = CORE_HASHES[rel];
  // A chunk, or the frame's assets: named by a hash or pinned by version,
  // nothing to check them against here.
  if (expected === undefined) return true;
  const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === expected;
}

// Filled while the page that registered this worker is still open, rather than
// on the next visit. The page has just downloaded every one of these, so they
// come back out of the browser's own cache and cost almost nothing now; leaving
// the cache to fill itself on the next visit would make the visit after that
// the first fast one. A failure here is not worth refusing to install over -
// the assets that did land still serve, and the rest are fetched on use.
//
// Fetched past the browser's HTTP cache (`cache: "reload"`): what is being
// written down here is this build, and the HTTP cache is where the previous
// one is still fresh for ten minutes after a deploy. It costs the bytes once
// more for the core assets, at the moment the page has finished with them.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(
        [...CORE, ...APP_FIRST_LOAD, ...DOCUMENTS].map(async (rel) => {
          const url = new URL(rel, BASE);
          const response = await fetch(url, { credentials: "same-origin", cache: "reload" });
          if (response.status !== 200) return;
          if (!(await matchesBuild(rel, response.clone()))) return;
          await cache.put(url, response);
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

  // The sample catalogue at samples/: its bundle, its stylesheet and its
  // index. Kept as they are used and deliberately NOT precached - apps.json
  // alone is most of a megabyte, and somebody who came to write ABAP must not
  // download a list of 770 samples to do it. One visit to the catalogue is
  // what puts it in the cache, and from then on an installed playground opens
  // it offline like everything else.
  //
  // Caching this index is right where caching the OLD examples data would have
  // been wrong: that was fetched from another host at run time, so a cached
  // copy meant yesterday's catalogue. This one is written by the deploy that
  // wrote the bundle beside it, so it is exactly as current as the build - and
  // the network-first path below still prefers a fresh answer.
  if (rel === "samples/apps.json" || rel === "samples/catalogue.mjs" || rel === "samples/catalogue.css") return true;
  // Monaco's icon font and the bundle's chunks, under the hashed names esbuild
  // gave them - the chunks are in CORE by name as well, this is for a chunk of
  // a build this worker was not written for, which is still worth keeping.
  if (/^assets\/[\w.-]+\.(ttf|mjs)$/.test(rel)) return true;
  return false;
}

// The two documents, by the name each is cached under: this page, whether
// asked for as the directory or as index.html, and the app frame's. A
// navigation to either carries whatever query and fragment the moment gave
// it - ?src=, ?embed=1, Run's counter - none of which changes the document,
// so the cache holds one copy under the bare name.
function documentOf(url, request) {
  if (request.mode !== "navigate" || url.origin !== BASE.origin) return undefined;
  const rel = url.pathname.slice(BASE.pathname.length);
  if (!url.pathname.startsWith(BASE.pathname)) return undefined;
  if (rel === "" || rel === "index.html") return new URL("index.html", BASE);
  if (rel === "app/index.html") return new URL("app/index.html", BASE);
  // The catalogue, asked for as the directory or as the file. It registers no
  // worker of its own - a reader who only wanted to look a sample up must not
  // be handed the playground's three megabytes of precache - so this only ever
  // runs for somebody the playground already installed for.
  if (rel === "samples/" || rel === "samples/index.html") return new URL("samples/index.html", BASE);
  return undefined;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }
  const doc = documentOf(url, event.request);
  if (doc) {
    event.respondWith(serveDocument(event, doc));
    return;
  }
  if (!isCacheable(url)) return;
  event.respondWith(serve(event));
});

// Network first, so a deploy reaches the next visit the way it always has;
// the cached copy only when the network has nothing to say - an installed
// playground opened on a train. The copy kept is the last clean answer, under
// the bare name, and a 200 is the only thing worth keeping: an error page
// cached as the document would be an error page forever.
async function serveDocument(event, doc) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(event.request);
    if (response.status === 200) {
      event.waitUntil(cache.put(doc, response.clone()).catch(() => {}));
    }
    return response;
  } catch (e) {
    const kept = await cache.match(doc);
    if (kept) return kept;
    throw e;
  }
}

async function serve(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;

  const response = await fetch(event.request);
  // Only a clean answer is worth keeping. A 404 or a redirect written in here
  // would outlive whatever produced it and be served back as though it were the
  // asset - and so would a core asset from another build, which is checked
  // the same way install checks it. The copies are taken before the response
  // is handed on, because reading the body is what consumes it - and the
  // write is handed to waitUntil so the browser does not stop the worker
  // half way through it.
  if (response.status === 200) {
    const rel = new URL(event.request.url).pathname.slice(BASE.pathname.length);
    const kept = response.clone();
    event.waitUntil(
      matchesBuild(rel, response.clone())
        .then((ok) => (ok ? cache.put(event.request, kept) : undefined))
        .catch(() => {}),
    );
  }
  return response;
}
