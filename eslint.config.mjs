// ESLint over the sources, the tools and the tests - `npm run lint`.
//
// Deliberately small: @eslint/js's recommended set and a handful of rules on
// top, no style rules (the layout is a matter for review, and nothing here is
// formatted by a tool - `var` in the frame's bridge script and in the sample
// pages' line links is left alone for the same reason). What it is for is the
// class of mistake no Playwright spec reports by name - a global that does not
// exist in the realm the file runs in, a variable assigned and never read, an
// import left behind by a refactor. So the GLOBALS ARE PER DIRECTORY, matching
// where each file really runs: the page, a worker, the service worker, Node.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    // Generated or copied, never edited here: deps/, build/ and dist/ are the
    // build's output, and src/vendor/ is abap2UI5/mcp-server's agent client
    // held to a recorded commit by tools/vendor-agent.mjs - a fix goes upstream.
    ignores: [
      ".claude/**",
      "deps/**",
      "build/**",
      "dist/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "src/vendor/**",
    ],
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // Arguments before the last one used are kept: a callback's signature is
      // positional, and `(_, i) =>` is not something to rename around.
      // A caught error nobody reads is the common case here (a storage access
      // that throws in a private window, a fetch that failed), and binding it
      // costs nothing, so that is not reported either.
      "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-undef": "error",
      // Functions and classes are hoisted and called later; only a `let` or
      // `const` read in its temporal dead zone is a real fault.
      "no-use-before-define": ["error", { functions: false, classes: false, variables: false }],
      "no-implicit-globals": "error",
      // A `let` declared first and assigned once further down is how a
      // closure gets to read something set after it was made (a timer's
      // handle, cleared by the callback that the timer is passed to).
      "prefer-const": ["error", { destructuring: "all", ignoreReadBeforeAssign: true }],
      // A no-break space inside a string or template is text the reader sees,
      // put there on purpose (after the search box's crumb arrow); in code or
      // a regular expression it is a mistake that looks like a space.
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-throw-literal": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "error",
      "no-unused-private-class-members": "error",
      "no-useless-rename": "error",
    },
  },

  // The page: the shell, the editor, the catalogue's bundles, the embed loader.
  {
    files: ["src/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Plain scripts, not modules: the fetch interception injected into the app
  // frame before the UI5 bootstrap, and the embed loader a host page includes
  // with a <script> tag.
  {
    files: ["src/shell/frontend-bridge.js", "src/embed/abap2ui5-embed.js"],
    languageOptions: { sourceType: "script" },
  },
  // The bridge runs in the app frame, where UI5 has defined `sap` by the time
  // its patches are called.
  {
    files: ["src/shell/frontend-bridge.js"],
    languageOptions: { globals: { sap: "readonly" } },
  },

  // Workers: the abaplint registry and the linter beside it, and the ABAP
  // runtime. No document, no window - `self` and postMessage.
  {
    files: [
      "src/editor/registry-worker.mjs",
      "src/editor/registry-core.mjs",
      "src/editor/transpile-core.mjs",
      "src/editor/lint-core.mjs",
      "src/editor/lint-entry.mjs",
      "src/runtime/**/*.mjs",
    ],
    languageOptions: { globals: { ...globals.worker } },
  },
  // The runtime bundle has Buffer as a global: esbuild injects
  // src/runtime/buffer-shim.mjs into it (tools/build-framework.mjs), because
  // the transpiled framework and open-abap-core reach for it the way Node
  // code does.
  {
    files: ["src/runtime/**/*.mjs"],
    languageOptions: { globals: { Buffer: "readonly" } },
  },

  // The service worker. A classic script whose top level IS the worker's own
  // global scope - nothing else shares it, so a function declared there is no
  // leak. The __NAMES__ are text markers tools/build-site.mjs replaces with
  // the build's id, chunk list and file names before the worker is written.
  {
    files: ["src/shell/sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.serviceworker,
        __BUILD_ID__: "readonly",
        __CHUNKS__: "readonly",
        __APP_FIRST_LOAD__: "readonly",
        __CORE__: "readonly",
        __DOCS__: "readonly",
        __ASSET_HASHES__: "readonly",
      },
    },
    rules: { "no-implicit-globals": "off" },
  },

  // Node: the build, the dev server, the configs - and the Evaluate page's
  // Astro project, whose modules run only at build time, in Node.
  {
    files: ["tools/**/*.mjs", "playwright.config.js", "eslint.config.mjs", "src/evaluate/**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },

  // The tests run in Node, but every page.evaluate( ) callback runs in the
  // page - so both sets, which is looser than either realm but the only
  // honest answer short of linting each callback on its own. The unit tests
  // under tests/node/ never touch a page, so Node's alone.
  {
    files: ["tests/**/*.{js,mjs}"],
    ignores: ["tests/node/**"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["tests/node/**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
];
