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

const result = await esbuild.build({
  entryPoints: [path.join(SHELL, "main.mjs")],
  outfile: path.join(ASSETS, "shell.mjs"),
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

fs.copyFileSync(path.join(SHELL, "index.html"), path.join(DIST, "index.html"));

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
// Everything the worker may cache goes into the id. The five core assets go in
// by content. dist/app - the UI5 build, thousands of files and most of the site
// by weight - goes in as a listing of paths and sizes: reading it whole to hash
// it would cost more than the rest of this step put together, and a UI5 build
// that changed without a single file changing size is not a thing that happens.
function writeServiceWorker() {
  const id = crypto.createHash("sha256");
  for (const rel of [
    "assets/shell.mjs",
    "assets/shell.css",
    "editor/corpus.json",
    "runtime/framework.mjs",
    "runtime/sql-wasm.wasm",
  ]) {
    id.update(rel);
    id.update(fs.readFileSync(path.join(DIST, rel)));
  }
  for (const entry of listing(path.join(DIST, "app")).sort()) id.update(entry);

  const source = fs.readFileSync(path.join(SHELL, "sw.js"), "utf8");
  if (!source.includes("__BUILD_ID__")) {
    console.error("build-site: ERROR src/shell/sw.js no longer has a __BUILD_ID__ to substitute");
    process.exit(1);
  }
  const build = id.digest("hex").slice(0, 16);
  fs.writeFileSync(path.join(DIST, "sw.js"), source.replaceAll("__BUILD_ID__", build));
  log(`sw.js (build ${build})`);
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
