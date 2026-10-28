#!/usr/bin/env node
// report2cloud in the playground: a classic report in the editor
// (zreport.prog.abap) is converted in the browser into a class of
// abap-cloud-gui's report runtime, and that class runs like any other.
// This step writes the three things the page needs for it, under
// dist/report2cloud/ - none of them on the way of a page that never opens a
// report, each fetched the first time one is converted:
//
//   convert.mjs   the converter (tools/report2cloud/lib of the pin), bundled
//                 for the registry worker, which imports it on the first
//                 conversion. It does not carry abaplint: the worker has it
//                 already, and lends it on globalThis.__pgAbaplint (see
//                 registry-worker.mjs) - a second copy would be two
//                 megabytes, and an abaplint node made by one copy is not an
//                 instance of the other's classes.
//   library.json  the ABAP of the report runtime (src/01 of the pin, the test
//                 includes left out) - the registry worker adds it to the
//                 corpus, so a converted class checks against the classes it
//                 inherits from and calls.
//   runtime.json  the same classes as the runtime takes them: transpiled here
//                 with transpileObjects( ) of src/editor/transpile-core.mjs,
//                 the function a Run compiles the editor's files with, so they
//                 are chunks exactly like those - defined before the user's on
//                 every Run of a converted report (src/shell/report2cloud.mjs).
//                 Transpiled once, at build time: the report runtime is twenty
//                 thousand lines, and a Run should not transpile them again.
//
// Cached by a stamp over the pin, the playground's transpile modules and
// this file, like the other steps; --force writes anyway.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import * as abaplint from "@abaplint/core";
import { transpileObjects } from "../src/editor/transpile-core.mjs";
import { uriFor } from "../src/editor/files.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(DIST, "report2cloud");
const ADDON = path.join(ROOT, "deps", "abap-cloud-gui");
const STAMP = path.join(ROOT, "build", "report2cloud.stamp");
const log = (line) => console.log(`build-report2cloud: ${line}`);
const kb = (file) => `${Math.round(fs.statSync(file).size / 1024)} KB`;

if (!fs.existsSync(path.join(ADDON, "src", "01"))) {
  console.error("build-report2cloud: deps/abap-cloud-gui is missing - run tools/fetch-deps.mjs first");
  process.exit(1);
}
const corpusFile = path.join(DIST, "editor", "corpus.json");
if (!fs.existsSync(corpusFile)) {
  console.error("build-report2cloud: dist/editor/corpus.json is missing - this step runs after build-site");
  process.exit(1);
}

// The report runtime: every object of src/01 but the test includes, and
// abapGit's package file. The XML is kept - the tables and data elements
// are nothing else, and abaplint reads a class's description from it.
function libraryFiles() {
  const dir = path.join(ADDON, "src", "01");
  return fs.readdirSync(dir)
    .filter((f) => /\.(abap|xml)$/.test(f) && !f.includes(".testclasses.") && f !== "package.devc.xml")
    .sort()
    .map((name) => ({ name, source: fs.readFileSync(path.join(dir, name), "utf8").replace(/^\uFEFF/, "") }));
}

const files = libraryFiles();
const head = fs.readFileSync(path.join(ADDON, ".git", "HEAD"), "utf8").trim();
const stamp = crypto.createHash("sha256")
  .update(head)
  .update(fs.readFileSync(fileURLToPath(import.meta.url)))
  .update(fs.readFileSync(path.join(ROOT, "src", "editor", "transpile-core.mjs")))
  .update(fs.readFileSync(path.join(ROOT, "src", "editor", "report2cloud-entry.mjs")))
  .update(fs.readFileSync(path.join(ROOT, "package-lock.json")))
  .digest("hex");
const outputs = ["convert.mjs", "library.json", "runtime.json"].map((f) => path.join(OUT, f));
if (!process.argv.includes("--force") && fs.existsSync(STAMP) && fs.readFileSync(STAMP, "utf8") === stamp
    && outputs.every((f) => fs.existsSync(f))) {
  log("up to date");
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

// --------------------------------------------------------------- converter

// @abaplint/core, and the one module of it the converter reaches into
// (the pretty printer's Indent), resolved to what the registry worker lends:
// the names of the real module, read here, each one a binding of
// globalThis.__pgAbaplint.
const CORE_NAMES = Object.keys(abaplint).filter((n) => n !== "default" && /^[A-Za-z_$][\w$]*$/.test(n));
const borrowedAbaplint = {
  name: "borrowed-abaplint",
  setup(build) {
    build.onResolve({ filter: /^@abaplint\/core(\/build\/src\/pretty_printer\/indent\.js)?$/ }, (args) => ({
      path: args.path, namespace: "borrowed-abaplint",
    }));
    build.onLoad({ filter: /.*/, namespace: "borrowed-abaplint" }, (args) => ({
      loader: "js",
      contents: args.path.endsWith("indent.js")
        ? "export const Indent = globalThis.__pgAbaplint.Indent;"
        : `const core = globalThis.__pgAbaplint;\nexport const { ${CORE_NAMES.join(", ")} } = core;\n`,
    }));
  },
};

await esbuild.build({
  entryPoints: [path.join(ROOT, "src", "editor", "report2cloud-entry.mjs")],
  outfile: path.join(OUT, "convert.mjs"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: process.env.PG_DEBUG !== "1",
  keepNames: true,
  sourcemap: process.env.PG_DEBUG === "1",
  logLevel: "warning",
  plugins: [borrowedAbaplint],
});
log(`report2cloud/convert.mjs (${kb(path.join(OUT, "convert.mjs"))})`);

// ------------------------------------------------------- the report runtime

fs.writeFileSync(path.join(OUT, "library.json"), JSON.stringify({ commit: head, files }));
log(`report2cloud/library.json (${files.length} files, ${kb(path.join(OUT, "library.json"))})`);

// The corpus as the worker holds it - dependencies - and the report runtime
// as the objects to transpile, against the framework of the corpus.
const corpus = JSON.parse(fs.readFileSync(corpusFile, "utf8"));
const reg = new abaplint.Registry(new abaplint.Config(JSON.stringify({
  ...abaplint.Config.getDefault().get(),
  syntax: { version: "v750", errorNamespace: "." },
})));
reg.addDependencies(Object.entries(corpus).map(([name, contents]) => new abaplint.MemoryFile(`/lib/${name}`, contents)));
for (const f of files) reg.addFile(new abaplint.MemoryFile(uriFor(f.name), f.source));
reg.parse();
const names = new Set(files.map((f) => f.name.split(".")[0].toUpperCase()));
const objects = [...reg.getObjects()].filter((o) => names.has(o.getName()));
const chunks = await transpileObjects(reg, objects);
// The line tables are for the editor's dumps - the report runtime is not in
// the editor, so they would only weigh.
fs.writeFileSync(path.join(OUT, "runtime.json"), JSON.stringify({
  commit: head,
  chunks: chunks.map(({ name, js }) => ({ name, js })),
}));
log(`report2cloud/runtime.json (${chunks.length} chunks, ${kb(path.join(OUT, "runtime.json"))})`);

fs.mkdirSync(path.dirname(STAMP), { recursive: true });
fs.writeFileSync(STAMP, stamp);
