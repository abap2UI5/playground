// The service worker, written - dist/sw.js out of src/shell/sw.js, with this
// build's id, its chunks and the hashes of everything it may keep substituted
// into it.
//
// Its own module rather than the tail of tools/build-site.mjs, which runs it
// last, once every file it hashes is on disk: what goes into the worker is a
// question of its own - which bytes make a build, which chunks every visitor
// downloads and which only the AI pages' visitors do - and it read as an
// appendix of a file that is mostly esbuild calls. Nothing here builds;
// everything is read off dist/ and off the page build's metafile, which the
// caller hands in.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appFirstLoad } from "../src/shell/warm-up.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = path.join(ROOT, "src", "shell");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(DIST, "assets");

const log = (m) => console.log(`build-site: ${m}`);

// src/shell/sw.js, with an id for this build written into it - see the comment
// at the top of that file for what the worker does with it. The id names the
// cache, so it is what keeps one build's assets from ever being served beside
// another's; and because the worker script is the only place it appears, a
// build that produced identical output produces an identical worker, which the
// browser then correctly declines to reinstall.
//
// Everything the worker may cache goes into the id. The core assets go in by
// content - everything under assets/, which is the bundle, its chunks, its
// stylesheet and Monaco's font, plus the corpus and the runtime. dist/app -
// the UI5 build, thousands of files and most of the site by weight - goes in
// as a listing of paths and sizes: reading it whole to hash it would cost
// more than the rest of this step put together, and a UI5 build that changed
// without a single file changing size is not a thing that happens.
//
// The chunks are written into the worker as well, so it can precache them:
// their names carry a hash, so no list in sw.js could name them in advance.
// And the core assets that do NOT carry one - the bundle, its stylesheet, the
// registry worker, the corpus, the framework, SQLite - go in with the hash
// of their bytes each, so the worker can refuse a copy from another build:
// the CDN and the HTTP cache both hand those out for a while after a deploy,
// and a cache filled from them was half of one build and half of the next.
export function writeServiceWorker({ metafile, monacoCss }) {
  const id = crypto.createHash("sha256");
  const unhashed = [
    "assets/shell.mjs",
    "assets/shell.css",
    "editor/registry.mjs",
    // The abap2UI5 linter, which the worker loads at run time: unhashed in
    // its name like the worker, so hashed here like the worker.
    "editor/lint.mjs",
    "editor/corpus.json",
    "runtime/framework.mjs",
    "runtime/sql-wasm.wasm",
    // The type. Not hashed in its name and not under assets/, so it is listed
    // here like the rest: without it an installed playground opened offline
    // falls back through the stack to the reader's own face, which is a
    // different page from the one they installed.
    "fonts/inter-roman-latin.woff2",
    "fonts/inter-italic-latin.woff2",
  ];
  const core = [
    ...fs.readdirSync(ASSETS).sort().map((name) => `assets/${name}`),
    ...unhashed.filter((rel) => !rel.startsWith("assets/")),
  ];
  const hashes = {};
  // And every file under assets/ - the chunks too, hashed in their names or
  // not - by the hash of its bytes, for the worker to check a cached copy
  // against before it serves it (ASSET_HASHES in sw.js): a cache entry is
  // something any script on this origin can write.
  const assetHashes = {};
  for (const rel of core) {
    const bytes = fs.readFileSync(path.join(DIST, rel));
    id.update(rel);
    id.update(bytes);
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");
    if (unhashed.includes(rel)) hashes[rel] = sha;
    if (rel.startsWith("assets/")) assetHashes[rel] = sha;
  }
  for (const entry of listing(path.join(DIST, "app")).sort()) id.update(entry);
  /* And the BYTES of everything outside app/resources/: the frontend's own
     files and the playground's frontend-bridge.js, which the worker serves
     cache-first with no hash of its own. By path and size alone, an edit
     that kept a file's length (a `!==` turned `===`, a constant changed)
     left the build id - and so the worker, and so every returning visitor's
     cached copy - exactly as it was. Seventy files and half a megabyte; the
     OpenUI5 tree under resources/ is version-pinned and stays a listing. */
  for (const entry of listing(path.join(DIST, "app")).sort()) {
    const rel = entry.slice(0, entry.lastIndexOf(":"));
    if (!rel.startsWith("resources/")) id.update(fs.readFileSync(path.join(DIST, "app", rel)));
  }

  /* The two documents, by their bytes as well: the worker keeps a document
     only beside the assets of its own build (DOC_HASHES in sw.js), so a
     change to index.html alone has to be a new build - or the worker would
     go on serving the document it holds for good. app/index.html is in the
     id already, with the rest of app/ outside resources/. */
  const docs = {};
  for (const rel of ["index.html", "app/index.html", "ai/index.html", "pilot/index.html"]) {
    const bytes = fs.readFileSync(path.join(DIST, rel));
    if (rel !== "app/index.html") id.update(bytes);
    docs[rel] = crypto.createHash("sha256").update(bytes).digest("hex");
  }

  const source = fs.readFileSync(path.join(SHELL, "sw.js"), "utf8");
  for (const marker of ["__BUILD_ID__", "__CHUNKS__", "__APP_FIRST_LOAD__", "__CORE__", "__DOCS__", "__ASSET_HASHES__"]) {
    if (!source.includes(marker)) {
      console.error(`build-site: ERROR src/shell/sw.js no longer has a ${marker} to substitute`);
      process.exit(1);
    }
  }
  const build = id.digest("hex").slice(0, 16);
  const precached = precachedChunks(metafile);
  // The frame's first load in both themes, for the worker to precache - the
  // list the page warms the HTTP cache with, so the two cannot drift apart.
  const firstLoad = [...new Set([...appFirstLoad("sap_horizon"), ...appFirstLoad("sap_horizon_dark")])];
  fs.writeFileSync(
    path.join(DIST, "sw.js"),
    source
      .replaceAll("__BUILD_ID__", build)
      /* Monaco's stylesheet is precached with the chunks: hashed in its name
         like them, and loaded by the first visit's page before the worker
         controls it, so the on-use path never sees that request. */
      .replace("__CHUNKS__", JSON.stringify([...chunks().filter((c) => precached.has(c)), monacoCss]))
      .replace("__APP_FIRST_LOAD__", JSON.stringify(firstLoad))
      .replace("__CORE__", JSON.stringify(hashes))
      .replace("__DOCS__", JSON.stringify(docs))
      .replace("__ASSET_HASHES__", JSON.stringify(assetHashes)),
  );
  log(`sw.js (build ${build})`);
}

// The chunks the two AI pages load (src/shell/ai-agent.mjs, the AI Studio's
// conversation with the app-building guide; src/shell/pilot-agent.mjs, the
// AI Pilot's with the vendored agent client) are left out of the worker's
// precache, and so is everything only they reach - the Anthropic SDK, which
// both import and esbuild therefore splits into a `chunk-<hash>.mjs` of its
// own, a name that says nothing about who needs it. Precached, they would be
// downloaded by every visitor the worker installs for, and the point of the
// chunks is that only somebody on one of those pages pays for them; the
// worker still keeps them once used (`assets/*.mjs` is on its allow list),
// and a chat needs the network to do anything anyway. So the precache is
// what the page bundle reaches WITHOUT crossing into one of those two - read
// off esbuild's own module graph rather than off the file names.
function precachedChunks(metafile) {
  /* The two AI conversations, and since the rooms around them became chunks
     of their own (src/shell/chat.mjs, src/shell/pilot.mjs - imported by
     main.mjs on their pages alone), those rooms too: a visitor who never
     opens either page has no use for them. */
  const ON_USE_ENTRIES = /^src\/shell\/(?:ai-agent|pilot-agent|chat|pilot)\.mjs$/;
  const outputs = metafile.outputs;
  const shell = Object.keys(outputs).find((o) => outputs[o].entryPoint === "src/shell/main.mjs");
  const reached = new Set();
  const stack = [shell];
  while (stack.length > 0) {
    const output = stack.pop();
    if (reached.has(output)) continue;
    reached.add(output);
    for (const { path: to, kind, external } of outputs[output]?.imports ?? []) {
      if (external || !outputs[to]) continue;
      if (kind === "dynamic-import" && ON_USE_ENTRIES.test(outputs[to].entryPoint ?? "")) continue;
      stack.push(to);
    }
  }
  return new Set([...reached].map((o) => path.relative(DIST, path.resolve(ROOT, o)).split(path.sep).join("/")));
}

// The bundle's chunks, as paths relative to dist/: every module under assets/
// that is not the entry itself.
export function chunks() {
  return fs
    .readdirSync(ASSETS)
    .filter((name) => name.endsWith(".mjs") && name !== "shell.mjs")
    .sort()
    .map((name) => `assets/${name}`);
}

function listing(dir, prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + e.name;
    if (e.isDirectory()) out.push(...listing(path.join(dir, e.name), `${rel}/`));
    else out.push(`${rel}:${fs.statSync(path.join(dir, e.name)).size}`);
  }
  return out;
}
