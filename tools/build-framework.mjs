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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPS = path.join(ROOT, "deps");
const BUILD = path.join(ROOT, "build");
const DOWNPORT = path.join(BUILD, "downport");
const OUTPUT = path.join(BUILD, "output");
const PG_ABAP = path.join(ROOT, "src", "abap");

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

transpile();

const modules = walk(OUTPUT).filter((f) => f.endsWith(".mjs"));
log(`${modules.length} modules in build/output`);
if (!fs.existsSync(path.join(OUTPUT, "init.mjs"))) {
  console.error("build-framework: ERROR build/output/init.mjs missing - transpile did not produce a runnable tree");
  process.exit(1);
}

// -------------------------------------------------------------------- bundle

// Several open-abap-core classes reach for Node's standard library: cl_abap_gzip
// wants zlib, cl_abap_message_digest and cl_abap_hmac want crypto, cl_http_client
// wants http/https/net/tls. Almost none of them is reachable from abap2UI5
// (checked against build/downport), but init.mjs imports every object in the
// library, so the modules have to resolve for the bundle to build.
//
// They resolve to a stub whose every entry point throws with the reason - if one
// of these classes is ever reached the message says what happened, instead of
// "createHash is not a function" from somewhere inside a transpiled method.
//
// `crypto` is the exception and resolves to a real implementation: every
// roundtrip mints a draft id through cl_system_uuid, which asks Node's crypto
// for randomUUID. See src/runtime/node-crypto-shim.mjs.
const NODE_STUBS = {
  zlib: ["constants", "deflateRawSync", "inflateRawSync", "gunzipSync", "gzipSync", "deflateSync", "inflateSync"],
  http: ["request", "get", "createServer"],
  https: ["request", "get", "createServer"],
  net: ["connect", "createConnection", "createServer", "Socket"],
  tls: ["connect", "createServer", "TLSSocket"],
  fs: ["readFileSync", "writeFileSync", "existsSync", "promises"],
  path: ["join", "resolve", "dirname", "basename", "extname", "sep"],
  url: ["fileURLToPath", "pathToFileURL", "parse", "format"],
  util: ["promisify", "inspect", "format", "types"],
};

const nodeStubPlugin = {
  name: "node-builtin-stubs",
  setup(build) {
    build.onResolve({ filter: /^(node:)?crypto$/ }, () => ({
      path: path.join(ROOT, "src", "runtime", "node-crypto-shim.mjs"),
    }));
    const names = Object.keys(NODE_STUBS).join("|");
    build.onResolve({ filter: new RegExp(`^(node:)?(${names})$`) }, (args) => ({
      path: args.path.replace(/^node:/, ""),
      namespace: "node-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "node-stub" }, (args) => {
      const message =
        `The playground runs in a browser. The ABAP that was called needs Node's ` +
        `'${args.path}' module, which does not exist here.`;
      const exports = NODE_STUBS[args.path]
        .map((n) => `export const ${n} = unavailable;`)
        .join("\n");
      return {
        loader: "js",
        contents:
          `function unavailable() { throw new Error(${JSON.stringify(message)}); }\n` +
          `${exports}\n` +
          `export default { ${NODE_STUBS[args.path].map((n) => `${n}: unavailable`).join(", ")} };\n`,
      };
    });
  },
};

// The transpiler percent-encodes characters that are not URL-safe into its
// import specifiers - `#ui2#cl_json.clas.mjs` is imported as
// `./%23ui2%23cl_json.clas.mjs`. Node's module loader decodes that; a bundler
// looking for a file of that literal name does not.
const percentEncodedPlugin = {
  name: "decode-percent-encoded-specifiers",
  setup(build) {
    build.onResolve({ filter: /%[0-9A-Fa-f]{2}/ }, (args) => {
      if (!args.path.startsWith(".")) return null;
      return { path: path.resolve(args.resolveDir, decodeURIComponent(args.path)) };
    });
  },
};

// The transpiler runtime picks its console before any playground code runs, and
// its default one writes to process.stdout. Resolving that module to a browser
// implementation is the only way in: by the time anything could assign
// abap.console, open-abap has already WRITEd during a class constructor.
const browserConsolePlugin = {
  name: "browser-console",
  setup(build) {
    const replacement = path.join(ROOT, "src", "runtime", "browser-console.mjs");
    build.onResolve({ filter: /console\/standard_out_console(\.js)?$/ }, () => ({ path: replacement }));
  },
};

async function bundle() {
  const esbuild = await import("esbuild");
  const outfile = path.join(ROOT, "dist", "runtime", "framework.mjs");

  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, "src", "runtime", "index.mjs")],
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
    plugins: [nodeStubPlugin, percentEncodedPlugin, browserConsolePlugin],
    inject: [path.join(ROOT, "src", "runtime", "buffer-shim.mjs")],
    logLevel: "warning",
    metafile: true,
  });

  fs.copyFileSync(
    path.join(ROOT, "node_modules", "sql.js", "dist", "sql-wasm-browser.wasm"),
    path.join(ROOT, "dist", "runtime", "sql-wasm.wasm"),
  );

  const kb = (n) => `${Math.round(n / 1024)} KB`;
  log(`bundled dist/runtime/framework.mjs (${kb(fs.statSync(outfile).size)})`);
  log(`plus dist/runtime/sql-wasm.wasm (${kb(fs.statSync(path.join(ROOT, "dist", "runtime", "sql-wasm.wasm")).size)})`);
  fs.writeFileSync(path.join(BUILD, "framework.metafile.json"), JSON.stringify(result.metafile));
}

await bundle();
