#!/usr/bin/env node
// Turns the abap2UI5 sources into JavaScript the browser can run.
//
// This is the same pipeline abap2UI5 runs in its own CI (see its package.json
// scripts `downport` and `auto_transpile`), pointed at deps/ instead of at a
// working copy:
//
//   deps/abap2ui5/src  +  src/abap  ->  build/downport  ->  build/output
//                        downport (abaplint --fix)   transpile
//
// The downport step rewrites modern ABAP into 702-compatible syntax, which is
// what the transpiler understands. It is slow (minutes) and deterministic, so
// the result is cached by a hash of its inputs - an unchanged tree skips
// straight to the transpile.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  browserConsolePlugin,
  generatedFrontendStubPlugin,
  nodeStubPlugin,
  percentEncodedPlugin,
} from "./esbuild-plugins.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPS = path.join(ROOT, "deps");
const BUILD = path.join(ROOT, "build");
const DOWNPORT = path.join(BUILD, "downport");
const OUTPUT = path.join(BUILD, "output");
const PG_ABAP = path.join(ROOT, "src", "abap");
// What this step is finally judged by: both have to exist for its output to
// count as current, or a deleted dist/ would be "cached" into a missing site.
const FRAMEWORK_BUNDLE = path.join(ROOT, "dist", "runtime", "framework.mjs");
const WASM_COPY = path.join(ROOT, "dist", "runtime", "sql-wasm.wasm");

const log = (m) => console.log(`build-framework: ${m}`);
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });

// ---------------------------------------------------------------- input hash

// Everything that can change what build/downport should contain. The abaplint
// version matters as much as the sources: a new downport rule produces a
// different tree from the same input.
function inputHash() {
  const h = crypto.createHash("sha256");
  const addTree = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) addTree(p);
      else h.update(p.slice(ROOT.length)).update(fs.readFileSync(p));
    }
  };
  addTree(path.join(DEPS, "abap2ui5", "src"));
  if (fs.existsSync(PG_ABAP)) addTree(PG_ABAP);
  addTree(path.join(DEPS, "open-abap-core", "src"));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  h.update(JSON.stringify(pkg.devDependencies));
  h.update(fs.readFileSync(fileURLToPath(import.meta.url)));
  return h.digest("hex");
}

// The second stamp: everything that decides what the transpile and the bundle
// should produce. That is the downported tree (whatever produced it), the
// transpiler and its runtime, and the playground's own runtime sources, which
// the bundle pulls in and the transpiler's `setup` option points at.
//
// Kept apart from inputHash( ) on purpose. The downport is three minutes and is
// keyed on its own inputs; the transpile and the bundle are about a minute
// together and are keyed on the downport's OUTPUT - so a change that the
// downport absorbs without changing a byte of build/downport correctly skips
// both, and a restored downport cache still has to prove the output tree
// matches before the transpile is skipped.
function outputHash() {
  const h = crypto.createHash("sha256");
  for (const file of walk(DOWNPORT).sort()) {
    h.update(path.relative(DOWNPORT, file)).update(fs.readFileSync(file));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  h.update(JSON.stringify(pkg.devDependencies));
  // The runtime the bundle is built from, and the esbuild plugins that build
  // it. A change to either has to rebuild framework.mjs.
  for (const dir of [path.join(ROOT, "src", "runtime")]) {
    for (const file of walk(dir).sort()) h.update(path.relative(ROOT, file)).update(fs.readFileSync(file));
  }
  h.update(fs.readFileSync(path.join(ROOT, "tools", "esbuild-plugins.mjs")));
  h.update(fs.readFileSync(fileURLToPath(import.meta.url)));
  // Debug builds differ from published ones in exactly this, and swapping
  // between them has to rebuild rather than reuse.
  h.update(String(process.env.PG_DEBUG === "1"));
  return h.digest("hex");
}

// ------------------------------------------------------------------ downport

function downport() {
  fs.rmSync(DOWNPORT, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });
  fs.cpSync(path.join(DEPS, "abap2ui5", "src"), DOWNPORT, { recursive: true });

  // The playground's own ABAP travels through the same downport and transpile
  // as the framework, so the bridge cannot drift from the framework it calls.
  if (fs.existsSync(PG_ABAP)) {
    fs.cpSync(PG_ABAP, path.join(DOWNPORT, "playground"), { recursive: true });
  }

  // Paths in an abaplint config are relative to the config file, so this one
  // lives next to the tree it describes. Rules are abap2UI5's own
  // .github/abaplint/abap_702.jsonc - the downport rule does the work, the
  // rest are the syntax checks that make a broken downport fail here rather
  // than inside the transpiler.
  const config = {
    global: { files: "/downport/**/*.*" },
    dependencies: [
      { url: "https://github.com/open-abap/open-abap-core", folder: "/../deps/open-abap-core", files: "/src/**/*.*" },
    ],
    syntax: { version: "v702", errorNamespace: "." },
    rules: {
      downport: true,
      begin_end_names: true,
      check_ddic: true,
      check_include: true,
      check_syntax: true,
      global_class: true,
      definitions_top: true,
      implement_methods: true,
      method_implemented_twice: true,
      parser_error: true,
      superclass_final: true,
      unknown_types: true,
      xml_consistency: true,
    },
  };
  const configPath = path.join(BUILD, "abaplint-downport.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  /* abap2UI5's downport shim, run against THIS repository's abaplint because
   * that is the install the downport below uses.
   *
   * Stock abaplint outlines a component-level table expression (`tab[ 1 ]-comp`)
   * into a work AREA - a copy - so the row reference is gone by the time the
   * framework sees it, and `client->_bind( tab = … tab_index = … )` refuses the
   * cell with BINDING_ERROR_TAB_CELL_LEVEL. The shim makes the outline
   * ASSIGNING, which is what the same abaplint rule's write path already emits.
   *
   * It is upstream's script from the clone fetch-deps already makes, never a
   * copy: it is a temporary shim for an abaplint defect and has to disappear
   * from every consumer on the same day. The bundle path is passed explicitly
   * because that clone has no node_modules of its own, so the script's default
   * would patch nothing and say so cheerfully.
   *
   * Why this matters HERE more than elsewhere: abap2UI5/web-abap2UI5 had the
   * same gap and found it as one red unit test. This pipeline has no such
   * test - the symptom is a runtime BINDING_ERROR_TAB_CELL_LEVEL in the
   * browser, in every sample that binds a cell, and nothing upstream of it
   * goes red.
   *
   * Applied only when the PINNED framework carries the script, and that is a
   * real condition rather than a soft one: the shim and the cell binding it
   * exists for arrived in the same upstream change (abap2UI5#2684). A pin
   * without the script is a pin without the feature, so there is nothing to
   * patch for; the pin that brings one brings the other and this runs. It is
   * deliberately NOT a silent fallback - the script itself still throws when
   * its anchors stop matching, which is how it announces that abaplint
   * shipped the fix and every consumer should drop it. */
  const shim = path.join(DEPS, "abap2ui5", "node/setup/patch-abaplint-downport.mjs");
  if (fs.existsSync(shim)) {
    run("node", [shim, path.join(ROOT, "node_modules/@abaplint/cli/build/cli.js")]);
  } else {
    log("downport shim: not in the pinned framework (pre-#2684) - nothing to patch");
  }

  log("downporting to v702 (this takes a few minutes)");
  // abaplint --fix exits non-zero while issues remain, which is the normal
  // state during a downport - the syntax check below is what decides.
  try {
    run("npx", ["abaplint", "--fix", configPath]);
  } catch {
    /* expected: --fix reports the issues it fixed */
  }

  // The two textual fixups abap2UI5 applies after the downport. The first
  // works around cx_sy_itab_line_not_found not existing in the transpiled
  // runtime; the second keeps the tree free of trailing whitespace, which
  // some downport fixes leave behind.
  for (const file of walk(DOWNPORT).filter((f) => f.endsWith(".abap"))) {
    const before = fs.readFileSync(file, "utf8");
    const after = before
      .replace(/ RAISE EXCEPTION TYPE cx_sy_itab_line_not_found/g, " ASSERT 1 = 0")
      .replace(/[ \t]+$/gm, "");
    if (after !== before) fs.writeFileSync(file, after);
  }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// ----------------------------------------------------------------- transpile

function transpile() {
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  const config = {
    input_folder: "build/downport",
    output_folder: "build/output",
    libs: [
      { url: "https://github.com/open-abap/open-abap-core", folder: "/deps/open-abap-core" },
    ],
    // Nothing here runs ABAP Unit, and the test classes are a large part of
    // the corpus - leaving them out keeps the bundle to what the page needs.
    write_unit_tests: false,
    write_source_map: false,
    options: {
      ignoreSyntaxCheck: false,
      addFilenames: true,
      addCommonJS: true,
      unknownTypes: "runtimeError",
      // REPOSRC would carry the ABAP source of every object into the bundle;
      // nothing in the playground reads it.
      populateTables: { reposrc: false },
      keywords: ["return", "in", "class", "for", "delete", "var", "with"],
      // Runs before any ABAP does and puts a sql.js database behind the
      // framework's SELECT/INSERT. Path is relative to output_folder.
      setup: { filename: "../../src/runtime/db-setup.mjs", preFunction: "setup" },
    },
  };
  const configPath = path.join(BUILD, "abap_transpile.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  log("transpiling to JavaScript");
  run("npx", ["abap_transpile", configPath]);
}

// ---------------------------------------------------------------------- main

const stampPath = path.join(BUILD, "downport.stamp");
const hash = inputHash();
const force = process.argv.includes("--force");

if (!force && fs.existsSync(stampPath) && fs.readFileSync(stampPath, "utf8").trim() === hash && fs.existsSync(DOWNPORT)) {
  log("downport up to date, reusing build/downport");
} else {
  downport();
  fs.writeFileSync(stampPath, hash);
}

// The transpile and the bundle, skipped together when nothing that feeds them
// has moved. They used to run on every build, downport cache or not - about a
// minute of a nine-hundred-object transpile and an eight-megabyte esbuild, for
// a byte-identical result. That is a minute off every warm CI job and off every
// rebuild somebody runs while working on the page.
const outStampPath = path.join(BUILD, "output.stamp");
const outHash = outputHash();
const outputIsCurrent =
  !force &&
  fs.existsSync(outStampPath) &&
  fs.readFileSync(outStampPath, "utf8").trim() === outHash &&
  fs.existsSync(path.join(OUTPUT, "init.mjs")) &&
  fs.existsSync(FRAMEWORK_BUNDLE) &&
  fs.existsSync(WASM_COPY);

if (outputIsCurrent) {
  log("transpile and bundle up to date, reusing build/output and dist/runtime");
} else {
  // Written only once both have succeeded, so an interrupted build is not
  // recorded as a finished one.
  transpile();

  const modules = walk(OUTPUT).filter((f) => f.endsWith(".mjs"));
  log(`${modules.length} modules in build/output`);
  if (!fs.existsSync(path.join(OUTPUT, "init.mjs"))) {
    console.error("build-framework: ERROR build/output/init.mjs missing - transpile did not produce a runnable tree");
    process.exit(1);
  }

  await bundle();
  fs.writeFileSync(outStampPath, outHash);
}

// -------------------------------------------------------------------- bundle

async function bundle() {
  const esbuild = await import("esbuild");
  const outfile = FRAMEWORK_BUNDLE;

  const result = await esbuild.build({
    // worker.mjs rather than index.mjs: the same exports, plus the message
    // handling the page talks to when this runs as a worker - which is how
    // index.html starts it.
    entryPoints: [path.join(ROOT, "src", "runtime", "worker.mjs")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    // Top-level await, which init.mjs uses, needs es2022 or later.
    target: "es2022",
    minify: process.env.PG_DEBUG !== "1",
    // open-abap implements RTTI by reading the JavaScript constructor name of a
    // runtime value (cl_abap_typedescr=>describe_by_data, via @KERNEL). A bundler
    // renames classes whenever names collide - and abap.types.String collides
    // with the global String on sight - so without this every DESCRIBE returns
    // the wrong type and the framework fails while building its type cache.
    keepNames: true,
    sourcemap: false,
    // The stub plugin goes first: it has to claim the generated frontend's
    // modules before the percent-decoding resolver gets a look at the same
    // specifiers.
    plugins: [generatedFrontendStubPlugin, nodeStubPlugin(ROOT), percentEncodedPlugin, browserConsolePlugin(ROOT)],
    inject: [path.join(ROOT, "src", "runtime", "buffer-shim.mjs")],
    logLevel: "warning",
    metafile: true,
  });

  fs.mkdirSync(path.dirname(WASM_COPY), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "node_modules", "sql.js", "dist", "sql-wasm-browser.wasm"), WASM_COPY);

  const kb = (n) => `${Math.round(n / 1024)} KB`;
  log(`bundled dist/runtime/framework.mjs (${kb(fs.statSync(outfile).size)})`);
  log(`plus dist/runtime/sql-wasm.wasm (${kb(fs.statSync(WASM_COPY).size)})`);
  fs.writeFileSync(path.join(BUILD, "framework.metafile.json"), JSON.stringify(result.metafile));
}
