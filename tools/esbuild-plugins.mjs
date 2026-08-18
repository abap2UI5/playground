// esbuild plugins shared by the framework bundle and the page bundle.
//
// Both bundles pull in code written for Node - the transpiled open-abap standard
// library on one side, abaplint and its dependencies on the other - and both
// have to resolve Node's built-in modules to something a browser can run.
import fs from "node:fs";
import path from "node:path";

// What each stub offers. A browser has none of this; the entries exist so the
// import resolves and so a call says what happened, rather than failing as
// "undefined is not a function" somewhere inside a library.
//
// `crypto` is not in this list: it resolves to a real implementation
// (src/runtime/node-crypto-shim.mjs) because the browser does have randomness,
// and abap2UI5 mints a draft id through it on every roundtrip.
const NODE_STUBS = {
  zlib: ["constants", "deflateRawSync", "inflateRawSync", "gunzipSync", "gzipSync", "deflateSync", "inflateSync"],
  http: ["request", "get", "createServer"],
  https: ["request", "get", "createServer"],
  net: ["connect", "createConnection", "createServer", "Socket"],
  tls: ["connect", "createServer", "TLSSocket"],
  fs: ["readFileSync", "writeFileSync", "existsSync", "promises"],
  path: ["join", "resolve", "dirname", "basename", "extname", "sep"],
  os: ["platform", "tmpdir", "EOL"],
  util: ["promisify", "inspect", "format", "types"],
};

export function nodeStubPlugin(root) {
  return {
    name: "node-builtin-stubs",
    setup(build) {
      build.onResolve({ filter: /^(node:)?crypto$/ }, () => ({
        path: path.join(root, "src", "runtime", "node-crypto-shim.mjs"),
      }));

      // `url` is asked for by source-map, and only as a fallback for browsers
      // without a global URL - which is every browser this runs in. So the stub
      // hands back the real thing instead of something that throws.
      build.onResolve({ filter: /^(node:)?url$/ }, () => ({ path: "url", namespace: "node-url" }));
      build.onLoad({ filter: /.*/, namespace: "node-url" }, () => ({
        loader: "js",
        contents:
          "export const URL = globalThis.URL;\n" +
          "export const URLSearchParams = globalThis.URLSearchParams;\n" +
          // The abap2UI5 linter locates its own data files relative to its
          // module, the way a Node library does. Both directions are pure
          // string work, so they can be answered honestly rather than stubbed -
          // and the paths they produce are what the fs shim below recognizes.
          "export function fileURLToPath(u) { return String(u).replace(/^file:\\/\\//, \"\"); }\n" +
          "export function pathToFileURL(p) { return new globalThis.URL(`file://${p}`); }\n" +
          "export default { URL, URLSearchParams, fileURLToPath, pathToFileURL };\n",
      }));

      const names = Object.keys(NODE_STUBS).join("|");
      build.onResolve({ filter: new RegExp(`^(node:)?(${names})$`) }, (args) => ({
        path: args.path.replace(/^node:/, ""),
        namespace: "node-stub",
      }));
      build.onLoad({ filter: /.*/, namespace: "node-stub" }, (args) => {
        const message =
          `The playground runs in a browser and has no Node '${args.path}' module. ` +
          `Whatever asked for it cannot work here.`;
        const exported = NODE_STUBS[args.path];
        return {
          loader: "js",
          contents:
            `function unavailable() { throw new Error(${JSON.stringify(message)}); }\n` +
            exported.map((n) => `export const ${n} = unavailable;`).join("\n") +
            `\nexport default { ${exported.map((n) => `${n}: unavailable`).join(", ")} };\n`,
        };
      });
    },
  };
}

// The transpiler percent-encodes characters that are not URL-safe into its
// import specifiers - `#ui2#cl_json.clas.mjs` is imported as
// `./%23ui2%23cl_json.clas.mjs`. Node's module loader decodes that; a bundler
// looking for a file of that literal name does not.
export const percentEncodedPlugin = {
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
export function browserConsolePlugin(root) {
  const replacement = path.join(root, "src", "runtime", "browser-console.mjs");
  return {
    name: "browser-console",
    setup(build) {
      build.onResolve({ filter: /console\/standard_out_console(\.js)?$/ }, () => ({ path: replacement }));
    },
  };
}


// The abap2UI5 linter in a browser.
//
// Its rules are pure - checkAbapSource( ) takes a string and returns findings -
// but the package around them is written for Node in two places that a bundler
// cannot follow, and both fail at *import* time rather than when called:
//
//   - lib/render.mjs takes a screenshot with a headless browser. It calls
//     createRequire( ) and os.tmpdir( ) at module top level, so a throwing stub
//     for either takes the whole bundle down on load. Nothing in
//     checkAbapSource( ) reaches it - openRenderer( ) is used only by
//     checkFiles( ) and screenshotFiles( ), which need a filesystem anyway.
//   - lib/icons.mjs and lib/properties.mjs read their metadata off disk,
//     relative to their own module URL. That data is two JSON files and does
//     not change between builds, so it is baked into the bundle and handed
//     back by a readFileSync that knows those two names and nothing else.
//     They also build those paths with path.join( ) at module top level, so
//     `path` gets a real implementation here rather than the throwing stub -
//     joining strings is not something a browser is unable to do.
//
// Scoped to the linter by the importer, so the rest of the page keeps the
// ordinary stubs: a stray readFileSync anywhere else still fails loudly.
export function abap2ui5LinterPlugin(root) {
  const LIB = path.join(root, "node_modules", "@abap2ui5", "linter", "lib");
  const DATA = path.join(root, "node_modules", "@abap2ui5", "linter", "data");
  const fromTheLinter = (importer) => importer.startsWith(LIB + path.sep);

  return {
    name: "abap2ui5-linter-in-a-browser",
    setup(build) {
      build.onResolve({ filter: /render\.mjs$/ }, (args) => {
        if (!fromTheLinter(args.importer)) return null;
        return { path: "render", namespace: "linter-render" };
      });
      build.onLoad({ filter: /.*/, namespace: "linter-render" }, () => ({
        loader: "js",
        contents:
          "export async function openRenderer() {\n" +
          "  throw new Error('Rendering a screenshot needs a headless browser, which the playground is already inside of.');\n" +
          "}\n",
      }));

      // Pure string work, so it is answered rather than stubbed. Only the
      // parts the linter uses, and `resolve` behaves as `join` because there
      // is no working directory to resolve against.
      build.onResolve({ filter: /^(node:)?path$/ }, (args) => {
        if (!fromTheLinter(args.importer)) return null;
        return { path: "path", namespace: "linter-path" };
      });
      build.onLoad({ filter: /.*/, namespace: "linter-path" }, () => ({
        loader: "js",
        contents:
          `const sep = "/";\n` +
          `function join(...parts) {\n` +
          `  const out = [];\n` +
          `  for (const piece of parts.join("/").split("/")) {\n` +
          `    if (piece === "" || piece === ".") continue;\n` +
          `    if (piece === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();\n` +
          `    else out.push(piece);\n` +
          `  }\n` +
          `  return (String(parts[0] ?? "").startsWith("/") ? "/" : "") + out.join("/");\n` +
          `}\n` +
          `function dirname(p) { const i = String(p).lastIndexOf("/"); return i <= 0 ? "." : String(p).slice(0, i); }\n` +
          `function basename(p) { return String(p).split("/").pop(); }\n` +
          `function extname(p) { const b = basename(p); const i = b.lastIndexOf("."); return i <= 0 ? "" : b.slice(i); }\n` +
          `const resolve = join;\n` +
          `export { sep, join, dirname, basename, extname, resolve };\n` +
          `export default { sep, join, dirname, basename, extname, resolve };\n`,
      }));

      build.onResolve({ filter: /^(node:)?fs$/ }, (args) => {
        if (!fromTheLinter(args.importer)) return null;
        return { path: "fs", namespace: "linter-fs" };
      });
      build.onLoad({ filter: /.*/, namespace: "linter-fs" }, () => {
        const bundled = {};
        for (const name of ["icons.json", "properties.json"]) {
          bundled[name] = fs.readFileSync(path.join(DATA, name), "utf8");
        }
        return {
          loader: "js",
          contents:
            `const FILES = ${JSON.stringify(bundled)};\n` +
            `const of = (p) => FILES[String(p).split(/[\\\\/]/).pop()];\n` +
            `export function readFileSync(p) {\n` +
            `  const hit = of(p);\n` +
            `  if (hit === undefined) throw new Error(\`The playground bundles only the linter's own metadata, not \${p}.\`);\n` +
            `  return hit;\n` +
            `}\n` +
            `export function existsSync(p) { return of(p) !== undefined; }\n` +
            `export default { readFileSync, existsSync };\n`,
        };
      });
    },
  };
}
