#!/usr/bin/env node
// Assembles dist/ - the static site GitHub Pages serves.
//
// The two slow halves are built elsewhere and left where they are:
// tools/build-framework.mjs writes dist/runtime, tools/build-ui5.mjs writes
// dist/app. This step is the page itself: the shell bundle, its stylesheet, and
// whatever static assets the shell needs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { nodeStubPlugin } from "./esbuild-plugins.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = path.join(ROOT, "src", "shell");
const DEPS = path.join(ROOT, "deps");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(DIST, "assets");

const log = (m) => console.log(`build-site: ${m}`);

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
function writeCorpus() {
  const files = {};
  const add = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        add(p);
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
  sourcemap: true,
  logLevel: "warning",
  metafile: true,
  // Monaco pulls in its stylesheet and its icon font through the module graph;
  // the CSS lands next to the bundle as assets/shell.css (the shell's own
  // stylesheet is imported by main.mjs so both end up in that one file), and
  // the font is copied out with a hashed name.
  loader: { ".ttf": "file" },
  plugins: [nodeStubPlugin(ROOT)],
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

fs.writeFileSync(path.join(ROOT, "build", "site.metafile.json"), JSON.stringify(result.metafile));
log("dist/ complete");
