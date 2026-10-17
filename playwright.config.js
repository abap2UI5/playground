import { defineConfig, devices } from "@playwright/test";

// PORT moves the server and the tests together, so two checkouts can test at
// once without one reusing the other's server (reuseExistingServer below).
const PORT = Number(process.env.PORT || 8080);

// Everything is tested through a real browser against the built dist/ - the
// playground has no meaningful behaviour outside one, and the pieces that
// could be tested under Node (the transpile, the shim) behave differently
// there than they do on a page. So: one target, the thing that ships.
//
// Bar tests/node/: `node --test` over the pure modules (the chain reader and
// writer, share links, the zip, the search matcher), which need no build and
// no browser - `npm run test:unit`. Their names match Playwright's default
// pattern, and node:test runs a file's tests as it is imported, so they are
// kept out of here by name.
export default defineConfig({
  testDir: "tests",
  testIgnore: "node/**",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html"], ["list"]] : "list",
  timeout: 120000,
  expect: { timeout: 30000 },
  // Two workers in CI, said rather than left to the default: one playground
  // boot keeps three threads busy at once (the page with Monaco, the corpus
  // parse, the runtime evaluating its bundle), so two already fill a 4-core
  // runner, and more only turn boots into timeouts. At a desk the default
  // stays - half the cores - and the obvious refinement, a worker per three
  // cores, was measured and refused: on a 4-core machine the shell, boot,
  // embed and editor specs took 215 s on two workers and 317 s on one. The
  // three threads of a boot are not all busy at once, and the runtime's
  // and the registry's are idle for most of a test.
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // In CI only for a retried test: a trace on every attempt recorded a
    // screencast and every network body for 300 tests that passed. A failure
    // that reproduces is retried (retries: 1) and gets its trace there.
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    // Blocked everywhere but tests/worker.spec.js, which is about it: after
    // the first run the worker installs and re-downloads the core assets
    // while the test is acting, and a reload was answered by the network or
    // the worker depending on whether that install had finished.
    serviceWorkers: "block",
    // Every test starts as somebody who has closed the first steps already
    // (src/shell/first-steps.mjs): almost every test opens the playground on
    // a fresh profile, which is a first visit, and a strip over the editor's
    // last lines is not what any of them is about. Here rather than in
    // tests/helpers.mjs because most specs open the page with page.goto( )
    // and not through a helper. tests/onboarding.spec.js empties it again;
    // a context a test makes for itself (browser.newContext( )) starts empty.
    storageState: {
      cookies: [],
      origins: [{
        origin: `http://localhost:${PORT}`,
        localStorage: [{ name: "abap2ui5-playground:first-steps", value: "closed" }],
      }],
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // WebKit over the specs that cover what has gone wrong in Safari before -
    // the corpus parse blowing the stack on mobile Safari, localStorage
    // throwing under blocked third-party storage in an embedded frame. The
    // two costliest incidents in this repository's history were Safari-only,
    // and every spec ran on Chromium alone. Opt-in (PW_WEBKIT=1), because
    // WebKit is one more browser to install: CI sets it, `npm test` at a desk
    // stays what it was.
    //
    // Because it is opt-in, a WebKit-only failure is invisible until CI runs,
    // and the project shipped red for exactly that reason: the four Share
    // tests granted the clipboard as a pair, and WebKit's grantPermissions
    // knows `clipboard-read` and not `clipboard-write`, so each died on its
    // first line with `Unknown permission: clipboard-write`. tests/helpers.mjs
    // `allowClipboard( )` is the guard, and its header says why nothing is
    // lost by it. When adding a spec here, the Playwright API a test calls is
    // the thing to check, not only the code under test.
    ...(process.env.PW_WEBKIT === "1"
      ? [{
          name: "webkit",
          use: { ...devices["Desktop Safari"] },
          testMatch: /(boot|embed|shell)\.spec\.js$/,
        }]
      : []),
  ],
  webServer: {
    command: "node tools/serve.mjs",
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
