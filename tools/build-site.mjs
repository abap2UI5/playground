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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = path.join(ROOT, "src", "shell");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(DIST, "assets");

const log = (m) => console.log(`build-site: ${m}`);

fs.mkdirSync(ASSETS, { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(SHELL, "main.mjs")],
  outfile: path.join(ASSETS, "shell.mjs"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  logLevel: "warning",
  metafile: true,
});

fs.copyFileSync(path.join(SHELL, "shell.css"), path.join(ASSETS, "shell.css"));
fs.copyFileSync(path.join(SHELL, "index.html"), path.join(DIST, "index.html"));

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
