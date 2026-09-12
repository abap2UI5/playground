import { defineConfig, devices } from "@playwright/test";

// Everything is tested through a real browser against the built dist/ - the
// playground has no meaningful behaviour outside one, and the pieces that
// could be tested under Node (the transpile, the shim) behave differently
// there than they do on a page. So: one target, the thing that ships.
export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html"], ["list"]] : "list",
  timeout: 120000,
  expect: { timeout: 30000 },
  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
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
    url: "http://localhost:8080/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
