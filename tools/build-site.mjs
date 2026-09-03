#!/usr/bin/env node
// Assembles dist/ - the static site GitHub Pages serves.
//
// The two slow halves are built elsewhere and left where they are:
// tools/build-framework.mjs writes dist/runtime, tools/build-ui5.mjs writes
// dist/app. This step is the page itself: the shell bundle, its stylesheet, and
// whatever static assets the shell needs.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { abap2ui5LinterPlugin, nodeStubPlugin } from "./esbuild-plugins.mjs";
import { appFirstLoad } from "../src/shell/warm-up.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = path.join(ROOT, "src", "shell");
const DEPS = path.join(ROOT, "deps");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(DIST, "assets");

// The one directory of abap2UI5 that never reaches the editor.
//
// abap2UI5 ships its UI5 frontend a second time, as ABAP: src/01/03 is
// app/webapp/ generated into `z2ui5_cl_ui5f_*` classes whose whole content is
// the frontend's JavaScript, XML, CSS and HTML held as string constants, so a
// real system can serve it over ICF. The playground serves none of that - the
// frontend it runs is built from source into dist/app - so in the editor's
// corpus these are payload and nothing else. Nobody control-clicks into a
// comment-stripped copy of a UI5 module to find out how abap2UI5 works, which
// is the argument that keeps the rest of the corpus whole (AGENTS.md, "the
// corpus ships whole").
//
// They are also what made the playground unusable on a phone. Generated ABAP
// puts a whole frontend module into ONE statement - the largest is 1600 tokens
// of `&& ... &&` - and abaplint parses an expression with recursive
// combinators, so that single statement drives the parser some 800 levels deep.
// With src/01/03 in it the boot parse needs more than 610 KB of JavaScript
// stack; without it, a little over 130 KB. Node and Chrome give a little under
// a megabyte, which is why this worked on every desk and on no iPhone: mobile
// Safari's stack is smaller, and the corpus parse threw RangeError: Maximum
// call stack size exceeded before the playground had finished starting.
// tools/check-size.mjs holds the parse to a budget so this cannot come back
// unnoticed.
const GENERATED_FRONTEND = path.join(DEPS, "abap2ui5", "src", "01", "03");

const log = (m) => console.log(`build-site: ${m}`);

// Cleared, not merged into: a file this step stops producing has to disappear
// from the published site, and a stale asset that nothing references any more
// is indistinguishable from one that does. dist/runtime and dist/app belong to
// the other two build steps and are left alone here.
for (const owned of [ASSETS, path.join(DIST, "editor"), path.join(DIST, "examples"), path.join(DIST, "embed")]) {
  fs.rmSync(owned, { recursive: true, force: true });
}
fs.mkdirSync(ASSETS, { recursive: true });
writeCorpus();

// The registry worker: abaplint, the corpus parse and the transpiler, as one
// bundle beside the corpus it fetches (src/editor/registry-worker.mjs). Its
// own bundle rather than a chunk of the page's, because a worker's script
// is a top-level fetch of its own - started by index.html before the page
// bundle has arrived - and because nothing in it is shared with the page:
// abaplint left the page bundle when the registry left the page's thread.
await esbuild.build({
  entryPoints: [path.join(ROOT, "src", "editor", "registry-worker.mjs")],
  outfile: path.join(DIST, "editor", "registry.mjs"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  // abaplint identifies some of its own node types by class name - see the
  // page bundle below, which needed this for the same library.
  keepNames: true,
  sourcemap: process.env.PG_DEBUG === "1",
  logLevel: "warning",
  plugins: [nodeStubPlugin(ROOT)],
  inject: [path.join(ROOT, "src", "runtime", "buffer-shim.mjs")],
});
log(`editor/registry.mjs (${Math.round(fs.statSync(path.join(DIST, "editor", "registry.mjs")).size / 1024)} KB)`);

// --------------------------------------------------------------- ABAP corpus

// The ABAP sources the editor knows about: abap2UI5 itself and the open-abap
// standard library. abaplint needs them to answer anything at all about the
// class in the editor - without z2ui5_if_app it cannot say whether main( ) is
// implemented, and without open-abap it cannot resolve the types that interface
// is written in.
//
// Shipped as one JSON file rather than 900 fetches. abaplint identifies an
// object by the file's base name, so the tree is flattened; package files are
// left out because they are the one base name that repeats and the editor has
// no use for them.
//
// And one directory is left out for a reason that has nothing to do with size.
// See GENERATED_FRONTEND above - it is the difference between a playground that
// starts on a phone and one that does not.
function writeCorpus() {
  const files = {};
  const add = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (p !== GENERATED_FRONTEND) add(p);
        continue;
      }
      if (!/\.(abap|xml)$/.test(e.name)) continue;
      if (e.name.includes(".testclasses.") || e.name.endsWith(".devc.xml")) continue;
      if (files[e.name] !== undefined) {
        throw new Error(`build-site: two source files are both called ${e.name}`);
      }
      files[e.name] = fs.readFileSync(p, "utf8");
    }
  };
  // A filter that quietly stops matching is the failure this cannot have: the
  // corpus would grow by a megabyte, the size budget would still pass it, and
  // the only report would be a phone somewhere that no longer starts.
  if (!fs.existsSync(GENERATED_FRONTEND)) {
    throw new Error(
      `build-site: ${path.relative(ROOT, GENERATED_FRONTEND)} is not there any more. ` +
        "That is where abap2UI5 keeps its generated frontend, which the corpus leaves out on " +
        "purpose - find where it moved to and point GENERATED_FRONTEND at it.",
    );
  }
  add(path.join(DEPS, "abap2ui5", "src"));
  add(path.join(DEPS, "open-abap-core", "src"));

  const out = path.join(DIST, "editor");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "corpus.json"), JSON.stringify(files));
  const mb = (fs.statSync(path.join(out, "corpus.json")).size / 1048576).toFixed(1);
  log(`corpus.json: ${Object.keys(files).length} ABAP sources (${mb} MB)`);
}

// The page bundle, in pieces: assets/shell.mjs is what the page cannot start
// without - Monaco - and what it only needs later comes as chunks of its
// own, which esbuild splits off wherever the source says import( ): the
// abap2UI5 linter with its half-megabyte of UI5 metadata
// (src/editor/abap2ui5-lint.mjs), which nothing needs before the corpus has
// parsed, and Monaco's own ABAP grammar. abaplint and the transpiler are in
// the registry worker's bundle above. What is split off downloads during
// the parse, where the network is idle, and is evaluated when it lands. The chunks
// carry a hash in their name, so the service worker's precache list and the
// build id are written from the directory rather than from a fixed list -
// see writeServiceWorker( ) below.
const result = await esbuild.build({
  entryPoints: [{ in: path.join(SHELL, "main.mjs"), out: "shell" }],
  outdir: ASSETS,
  outExtension: { ".js": ".mjs" },
  splitting: true,
  chunkNames: "[name]-[hash]",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  // abaplint identifies some of its own node types by class name, so a bundler
  // that renames classes changes what it resolves - the same trap the framework
  // bundle hits through open-abap's RTTI.
  keepNames: true,
  // 20 MB of source map, a sixth of the published site, that only a browser
  // with devtools open ever fetches - and anyone debugging the playground has
  // the sources anyway. PG_DEBUG=1 builds it, the same switch the framework
  // bundle uses.
  sourcemap: process.env.PG_DEBUG === "1",
  logLevel: "warning",
  metafile: true,
  // Monaco pulls in its stylesheet and its icon font through the module graph;
  // the CSS lands next to the bundle as assets/shell.css (the shell's own
  // stylesheet is imported by main.mjs so both end up in that one file), and
  // the font is copied out with a hashed name.
  loader: { ".ttf": "file" },
  // The linter plugin goes first: it claims `fs` and `path` for the abap2UI5
  // linter alone, and leaves every other importer to the ordinary stubs.
  plugins: [abap2ui5LinterPlugin(ROOT), nodeStubPlugin(ROOT)],
  // abaplint reaches for Buffer when it builds its DDIC built-ins, the same way
  // the transpiled standard library does.
  inject: [path.join(ROOT, "src", "runtime", "buffer-shim.mjs")],
});

writeIndex();
// The icons and the app manifest - what a tab, a home screen and an install
// prompt show for this page.
for (const name of ["favicon.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "manifest.webmanifest"]) {
  fs.copyFileSync(path.join(SHELL, name), path.join(DIST, name));
}

// A same-origin ABAP file, so ?src= can be exercised without depending on
// somebody else's host being up. It is also the smallest possible worked
// example for anyone wondering what a linkable file looks like.
fs.mkdirSync(path.join(DIST, "examples"), { recursive: true });
for (const name of fs.readdirSync(path.join(ROOT, "src", "examples"))) {
  fs.copyFileSync(path.join(ROOT, "src", "examples", name), path.join(DIST, "examples", name));
}

// The embedding kit: the loader a documentation page includes, and the page
// that demonstrates it. Copied rather than bundled - it is a plain script that
// somebody else's site includes with a <script src>, so it has to stay one
// readable file with no build step behind it.
fs.mkdirSync(path.join(DIST, "embed"), { recursive: true });
for (const name of fs.readdirSync(path.join(ROOT, "src", "embed"))) {
  fs.copyFileSync(path.join(ROOT, "src", "embed", name), path.join(DIST, "embed", name));
}

const kb = (p) => `${Math.round(fs.statSync(p).size / 1024)} KB`;
log(`shell.mjs (${kb(path.join(ASSETS, "shell.mjs"))})`);
for (const chunk of chunks()) log(`${path.basename(chunk)} (${kb(path.join(DIST, chunk))})`);

// Fail loudly rather than publish a page whose two halves are missing - the
// symptom would otherwise be a blank frame and a 404 in the console.
for (const required of ["runtime/framework.mjs", "runtime/sql-wasm.wasm", "app/index.html"]) {
  if (!fs.existsSync(path.join(DIST, required))) {
    console.error(`build-site: ERROR dist/${required} is missing - run the full build (npm run build)`);
    process.exit(1);
  }
}

writeServiceWorker();

// ------------------------------------------------------------ service worker

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
function writeServiceWorker() {
  const id = crypto.createHash("sha256");
  const unhashed = [
    "assets/shell.mjs",
    "assets/shell.css",
    "editor/registry.mjs",
    "editor/corpus.json",
    "runtime/framework.mjs",
    "runtime/sql-wasm.wasm",
  ];
  const core = [
    ...fs.readdirSync(ASSETS).sort().map((name) => `assets/${name}`),
    ...unhashed.filter((rel) => !rel.startsWith("assets/")),
  ];
  const hashes = {};
  for (const rel of core) {
    const bytes = fs.readFileSync(path.join(DIST, rel));
    id.update(rel);
    id.update(bytes);
    if (unhashed.includes(rel)) hashes[rel] = crypto.createHash("sha256").update(bytes).digest("hex");
  }
  for (const entry of listing(path.join(DIST, "app")).sort()) id.update(entry);

  const source = fs.readFileSync(path.join(SHELL, "sw.js"), "utf8");
  for (const marker of ["__BUILD_ID__", "__CHUNKS__", "__APP_FIRST_LOAD__", "__CORE__"]) {
    if (!source.includes(marker)) {
      console.error(`build-site: ERROR src/shell/sw.js no longer has a ${marker} to substitute`);
      process.exit(1);
    }
  }
  const build = id.digest("hex").slice(0, 16);
  // The frame's first load in both themes, for the worker to precache - the
  // list the page warms the HTTP cache with, so the two cannot drift apart.
  const firstLoad = [...new Set([...appFirstLoad("sap_horizon"), ...appFirstLoad("sap_horizon_dark")])];
  fs.writeFileSync(
    path.join(DIST, "sw.js"),
    source
      .replaceAll("__BUILD_ID__", build)
      .replace("__CHUNKS__", JSON.stringify(chunks()))
      .replace("__APP_FIRST_LOAD__", JSON.stringify(firstLoad))
      .replace("__CORE__", JSON.stringify(hashes)),
  );
  log(`sw.js (build ${build})`);
}

// index.html, with a modulepreload for every chunk assets/shell.mjs imports
// statically. Splitting the bundle put the code the entry shares with its
// chunks - most of abaplint, which the transpiler needs too - into a chunk of
// its own that shell.mjs imports at its top, and a static import is only
// discovered once the importing file has arrived: without the preload the
// chunk would be fetched after the bundle instead of beside it, a round trip
// and a serialized download on the path to the first editor frame. The names
// carry a hash, so the tags are written here rather than by hand. Only the
// static imports: the dynamic ones are wanted during the parse and fetched
// then, where the network is idle.
function writeIndex() {
  const entry = result.metafile.outputs[path.relative(ROOT, path.join(ASSETS, "shell.mjs"))];
  const tags = entry.imports
    .filter((i) => i.kind === "import-statement")
    .map((i) => `<link rel="modulepreload" href="${path.relative(DIST, path.join(ROOT, i.path))}">`);
  const source = fs.readFileSync(path.join(SHELL, "index.html"), "utf8");
  const marker = "<!-- __MODULEPRELOADS__ -->";
  if (!source.includes(marker)) {
    console.error(`build-site: ERROR src/shell/index.html no longer has a ${marker} to substitute`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(DIST, "index.html"), source.replace(marker, tags.join("\n")));
  log(`index.html (${tags.length} chunk${tags.length === 1 ? "" : "s"} preloaded)`);
}

// The bundle's chunks, as paths relative to dist/: every module under assets/
// that is not the entry itself.
function chunks() {
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

fs.writeFileSync(path.join(ROOT, "build", "site.metafile.json"), JSON.stringify(result.metafile));
log("dist/ complete");
