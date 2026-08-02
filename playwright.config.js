// Playwright config — end-to-end browser tests for the served site.
//
// This is the repo's first real toolchain dependency: a browser runner plus
// cached browser binaries in CI. Nothing here enters the served page, so the
// no-build-step rule still holds. The specs live under tests/e2e/*.spec.js
// (deliberately NOT *-test.js, so tests/run-all.js never tries to run them as
// plain Node) and are kept OUT of `npm test` — run them with `npm run test:e2e`.
//
// The webServer is our own zero-dependency Node static server (tools/
// static-server.js): CI has no Python, so `python -m http.server` is not an
// option there.

const { defineConfig, devices } = require("@playwright/test");

const PORT = Number(process.env.E2E_PORT || 8123);
const BASE_URL = `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.js",
  // The site is static and deterministic; a flake here is a real bug, not
  // load-order noise — so no retries locally. CI gets one to absorb pure
  // browser-launch jitter, no more.
  retries: process.env.CI ? 1 : 0,
  // A stray `test.only` left in a spec must fail CI, never silently narrow it.
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // WebKit as a second engine so cross-engine breakage surfaces here rather
    // than in production. Its own project keeps the flake it can introduce
    // isolated and revertible.
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: `node tools/static-server.js --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
});
