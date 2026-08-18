// esbuild plugins shared by the framework bundle and the page bundle.
//
// Both bundles pull in code written for Node - the transpiled open-abap standard
// library on one side, abaplint and its dependencies on the other - and both
// have to resolve Node's built-in modules to something a browser can run.
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
          "export default { URL, URLSearchParams };\n",
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
