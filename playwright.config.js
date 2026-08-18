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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node tools/serve.mjs",
    url: "http://localhost:8080/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
