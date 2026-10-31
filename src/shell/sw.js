// The second visit, without the download.
//
// Before this page can do anything it fetches about seven megabytes over the
// wire: the shell bundle, which carries Monaco (the abap2UI5 linter as a
// chunk); the registry worker, which carries abaplint and the transpiler; the
// transpiled framework; the ABAP corpus the editor checks against; and SQLite
// as WebAssembly. None of it changes between
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

// The bundle's chunks - Monaco's ABAP grammar, the AI chunks' shared half -
// split off the shell bundle and named with a hash, written in by
// tools/build-site.mjs, which is the only place that knows their names, and
// Monaco's stylesheet beside them, hashed the same way (the page links it
// before this worker controls it, so on-use caching would never see it). The
// abap2UI5 linter is not one of them any more: it is editor/lint.mjs, loaded
// by the registry worker and listed with the core assets.
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
// The AI Studio's page too (ai/index.html), and the AI Pilot's
// (pilot/index.html): they run on the same bundle, and left out each went to
// the network after a deploy and paired the new document with this build's
// cached assets - the mix DOC_HASHES exists to prevent.
const DOCUMENTS = ["index.html", "app/index.html", "ai/index.html", "pilot/index.html"];

// And what this build's two documents hash to, written in by the build like
// CORE_HASHES. A document is network-first, the assets beside it cache-first,
// and a worker published by a later deploy only takes over once no tab of the
// playground is open - a RELOAD does not let it, because the page being
// reloaded is still this worker's client while the new navigation is fetched.
// So after a deploy a reload got the NEW index.html over this worker's OLD
// shell bundle, and the new frame document over the old frontend: markup
// reaching for elements the bundle did not know, until the boot failed and
// the whole cache was thrown away. A document that is not this build's is
// now answered with the copy this build kept, so the pair stays whole until
// the new worker takes over with its own.
const DOC_HASHES = __DOCS__;

// And every file under assets/ - the bundle's chunks included, whose names
// carry esbuild's hash but nothing this worker could check - by the SHA-256
// of the bytes this build wrote. Written in by the build like the two above.
const ASSET_HASHES = __ASSET_HASHES__;

// And the frame's files - UI5, the frontend, the bridge - by their bytes too,
// in a file of their own beside this worker (writeAppHashes( ) in
// tools/service-worker.mjs says why there), which this worker knows by the
// hash written in here.
const APP_HASHES_FILE = "app-hashes.json";
const APP_HASHES = "__APP_HASHES__";
// What the frame loads that runs nothing: images and fonts, not in the file.
const INERT = /\.(png|gif|jpe?g|ico|woff2?|ttf|eot)$/i;

const expectedHash = (rel) =>
  rel === APP_HASHES_FILE ? APP_HASHES : CORE_HASHES[rel] ?? DOC_HASHES[rel] ?? ASSET_HASHES[rel];
const hexOf = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function matchesBuild(rel, response) {
  const expected = expectedHash(rel);
  // The frame's assets: pinned by version, nothing to check them against.
  if (expected === undefined) return true;
  return (await hexOf(await response.arrayBuffer())) === expected;
}

// A CACHED copy, checked on its way OUT as well as on its way in.
//
// What goes into this cache is checked against the build (matchesBuild( )
// above), but the cache is not this worker's alone: every script of this
// origin can open it by name - the name is in this file, and caches.keys( )
// lists it anyway - and put what it likes under any URL. The playground's
// app frame is this origin (src/shell/page.mjs says why), so a share link's
// app could write a script of its own in place of assets/shell.mjs or a
// chunk, and every later visit - the AI pages', where an API key is typed,
// included - ran it from here, cache-first, without a request. (The runtime
// worker, where a link's ABAP runs, cannot open the cache at all:
// src/runtime/lockdown.mjs.)
//
// So a hit for anything this build has a hash for - the documents, the core
// assets, every chunk and stylesheet under assets/ - is hashed before it is
// served, and one that does not match is dropped and fetched again. That is
// every script the playground's pages and workers run, about twenty
// megabytes. Measured (2026-10-17, Chromium, WebCrypto, the four largest
// files hashed in parallel as the requests arrive): 70 to 210 ms for all
// twenty on a busy 4-core machine - off the page's thread, and spread over
// requests the page makes side by side, so what a visit waits for is the
// framework's share, a few tens of milliseconds, against the download it
// would otherwise be.
// An unguessable cache name was the cheaper idea and is no defence:
// caches.keys( ) hands any script the names.
//
// The frame's files under app/ are checked the same way, against
// app-hashes.json. They were left out at first - pinned by version, and the
// AI pages' frame is on an opaque origin this worker never serves - but the
// playground's frame is this origin, so a link's view could put its own
// sap-ui-core.js here, and every later visit to the playground ran it before
// anything else: past the Gist caution, which only knows about the code of
// THIS visit, and able to rewrite the stored provider settings the next
// time. Their hashes are cut to 128 bits, which is still nothing anybody
// forges. A copy under app/ that the file does not name is not served at
// all; nor is any while the file cannot be had - the network answers
// instead, which offline is no answer, and that is the safe way round.
async function verifiedHit(cache, key, rel) {
  const hit = await cache.match(key);
  if (!hit) return undefined;
  let expected = expectedHash(rel);
  if (expected === undefined && rel.startsWith("app/") && !INERT.test(rel)) {
    const hashes = await appHashes(cache);
    expected = hashes?.[rel];
    if (expected === undefined) return undefined;
  }
  if (expected === undefined) return hit;
  const bytes = await hit.arrayBuffer();
  if ((await hexOf(bytes)).slice(0, expected.length) !== expected) {
    await cache.delete(key).catch(() => {});
    return undefined;
  }
  return new Response(bytes, { status: hit.status, statusText: hit.statusText, headers: hit.headers });
}

// app-hashes.json, read once for as long as this worker runs: from the cache
// it was precached into, else from the network - each copy checked against
// APP_HASHES, a copy somebody wrote into the cache included, and a good one
// from the network kept for offline. Undefined when no copy passes; asked
// again next time rather than remembered as missing.
let appHashesRead;
function appHashes(cache) {
  appHashesRead ??= (async () => {
    const url = new URL(APP_HASHES_FILE, BASE);
    const sources = [
      () => cache.match(url),
      () => fetch(url, { credentials: "same-origin" }),
      () => fetch(url, { credentials: "same-origin", cache: "reload" }),
    ];
    for (const [i, get] of sources.entries()) {
      try {
        const response = await get();
        if (!response || response.status !== 200) continue;
        const bytes = await response.arrayBuffer();
        if ((await hexOf(bytes)) !== APP_HASHES) {
          if (i === 0) await cache.delete(url).catch(() => {});
          continue;
        }
        if (i > 0) {
          await cache
            .put(url, new Response(bytes, { headers: { "content-type": "application/json" } }))
            .catch(() => {});
        }
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        // The next source; none left is no file.
      }
    }
    return undefined;
  })();
  const read = appHashesRead;
  read.then((hashes) => {
    if (!hashes && appHashesRead === read) appHashesRead = undefined;
  });
  return read;
}

// Filled while the page that registered this worker is still open, rather than
// on the next visit. The page has just downloaded every one of these, so they
// come back out of the browser's own cache and cost almost nothing now; leaving
// the cache to fill itself on the next visit would make the visit after that
// the first fast one. A failure here is not worth refusing to install over -
// the assets that did land still serve, and the rest are fetched on use.
//
// Fetched past the browser's HTTP cache (`cache: "reload"`) ONLY where that
// buys anything: the core assets, whose names carry no hash and whose bytes
// are therefore checked against the build (CORE_HASHES), and the frontend's
// component bundle, which is unhashed and moves with the frontend pin. The
// HTTP cache is where the previous build is still fresh for ten minutes
// after a deploy, and for those a stale copy is a copy that fails the check.
// The chunks are named by their hash and the UI5 resources are pinned by
// version, so for them the HTTP cache is exactly the right answer - and
// fetching them past it cost a first visit about five megabytes over the
// wire a second time, right after it had finished downloading them.
// The two documents as well: a worker installing from a tab whose index.html
// is still fresh in the HTTP cache stored the previous build's document under
// the new build's cache, and an installed playground opened offline paired it
// with the new bundle - the mix CORE_HASHES exists to prevent.
//
// The core assets try the HTTP cache first all the same, because they CAN be
// checked: the page that registered this worker has just downloaded them, and
// on all but the first install after a deploy that copy is this build's and
// passes. Only a copy that fails the check goes to the network again - so the
// megabyte or so of core bundle is not downloaded twice on every first visit.
const RELOAD = (rel) =>
  rel === "app/Component-preload.js" ||
  rel === "app/frontend-bridge.js" ||
  rel === APP_HASHES_FILE ||
  DOCUMENTS.includes(rel);
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(
        [...CORE, ...APP_FIRST_LOAD, ...DOCUMENTS, APP_HASHES_FILE].map(async (rel) => {
          const url = new URL(rel, BASE);
          const get = (mode) => fetch(url, { credentials: "same-origin", cache: mode });
          let response = await get(RELOAD(rel) ? "reload" : "default");
          if (response.status === 200 && !(await matchesBuild(rel, response.clone()))) {
            // A document is fetched past the HTTP cache already; one that is
            // still not this build's is a CDN a deploy behind, and not kept.
            if (!(rel in CORE_HASHES)) return;
            response = await get("reload");
            if (response.status === 200 && !(await matchesBuild(rel, response.clone()))) return;
          }
          if (response.status !== 200) return;
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
  // stylesheet it loads (?sap-ui-dist-version=1.153.0) and on the manifest
  // (?sap-language=EN), and both name something fixed for a build rather than
  // a moment - so refusing them left the two theme stylesheets, which block
  // the app's first paint, going to the network on every single Run.
  if (rel.startsWith("app/")) return rel !== "app/index.html";

  // Everywhere else a query says the URL is about a particular moment -
  // somebody's cache buster, a draft - and caching one moment is how a cache
  // fills up with things that will never be asked for again.
  if (url.search !== "") return false;
  if (CORE.includes(rel)) return true;

  // The sample catalogue's own files go through isLive( ) below - kept, but
  // never ahead of the network.
  if (LIVE.has(rel)) return true;
  // Monaco's icon font, its stylesheet and the bundle's chunks, under the
  // hashed names esbuild gave them - the chunks and the stylesheet are in
  // CORE by name as well, this is for one of a build this worker was not
  // written for, which is still worth keeping.
  if (/^assets\/[\w.-]+\.(ttf|mjs|css)$/.test(rel)) return true;
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
  if (rel === "ai/" || rel === "ai/index.html") return new URL("ai/index.html", BASE);
  if (rel === "pilot/" || rel === "pilot/index.html") return new URL("pilot/index.html", BASE);
  return undefined;
}

// The sample index at samples/apps.json: the playground's own samples
// dialog reads it, and so does the samples site's build. Kept as it is used
// and deliberately NOT precached - it is most of a megabyte, and somebody who
// came to write ABAP must not download a list of 770 samples to do it.
//
// NETWORK FIRST, like the documents, and unlike every other asset. The index
// is written by the deploy that wrote the bundle beside it, but the deploy
// that changes it is usually not the deploy that changes the bundle: the site
// is published every night so that a sample merged today is listed tomorrow,
// and a night where only the index moved produces a worker identical to the
// one before it - same build id, same cache - so no new worker installs and
// nothing ever evicts the copy. Served cache-first, that copy was
// yesterday's index for every visitor who had ever opened the playground. So
// this asks the network and falls back to the cache, and the cache is
// refreshed by every answer.
const LIVE = new Set(["samples/apps.json"]);
function isLive(url) {
  if (url.origin !== BASE.origin || url.search !== "") return false;
  if (!url.pathname.startsWith(BASE.pathname)) return false;
  return LIVE.has(url.pathname.slice(BASE.pathname.length));
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
  if (isLive(url)) {
    event.respondWith(serveDocument(event, event.request));
    return;
  }
  if (!isCacheable(url)) return;
  event.respondWith(serve(event));
});

// Network first, so a deploy reaches the next visit the way it always has;
// the cached copy only when the network has nothing to say - an installed
// playground opened on a train - or says only that it failed. The copy kept is the last clean answer, under
// the bare name, and a 200 is the only thing worth keeping: an error page
// cached as the document would be an error page forever.
async function serveDocument(event, doc) {
  const cache = await caches.open(CACHE);
  const rel = new URL(doc.url ?? doc).pathname.slice(BASE.pathname.length);
  const kept = await verifiedHit(cache, doc, rel);
  // Past the HTTP cache (revalidated - a 304 when nothing moved): Pages
  // keeps a document fresh for ten minutes, and in the minutes after a
  // deploy the old index.html answered beside the new build's cached
  // bundle, and was then written over the clean precached copy.
  const network = (async () => {
    const response = await fetch(event.request, { cache: "no-cache" });
    // An answer that is not ok - a 503 while Pages is having a moment, a
    // captive portal's error - is no better than no answer: with a good copy
    // kept, that copy is the page. It used to be served over the copy, and a
    // transient 5xx was the playground gone for as long as it lasted.
    if (!response.ok) return kept ?? response;
    if (response.status !== 200) return response;
    if (rel in DOC_HASHES && !(await matchesBuild(rel, response.clone()))) {
      // Another build's document - see DOC_HASHES. The kept copy if there
      // is one; without one, the network's is all there is, and it is not
      // kept.
      return kept ?? response;
    }
    await cache.put(doc, response.clone()).catch(() => {});
    return response;
  })();
  // The refresh finishes, and is kept, whichever answer the page gets.
  event.waitUntil(network.catch(() => {}));
  if (!kept) return network;
  // NOT FOREVER, when there is a copy to fall back to. A connection that is
  // up but answers nothing (a captive portal, a train between two cells) held
  // the navigation until the socket gave up minutes later, and a Run waited on
  // a stalled app/index.html until its own thirty seconds ran out - with the
  // worker holding a good copy of both. Four seconds, then the copy; the
  // network's answer still lands in the cache for the next time.
  const late = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
  try {
    return (await Promise.race([network, late])) ?? kept;
  } catch {
    return kept;
  }
}

async function serve(event) {
  const cache = await caches.open(CACHE);
  const rel = new URL(event.request.url).pathname.slice(BASE.pathname.length);
  const hit = await verifiedHit(cache, event.request, rel);
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
    const kept = response.clone();
    event.waitUntil(
      matchesBuild(rel, response.clone())
        .then((ok) => (ok ? cache.put(event.request, kept) : undefined))
        .catch(() => {}),
    );
  }
  return response;
}
