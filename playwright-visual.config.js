// Playwright config for depth gate C — visual regression only.
//
// Kept separate from playwright.config.js (the functional e2e matrix) on
// purpose: this gate is chromium-only and its pixel baselines are the `-linux`
// set generated on the ubuntu CI runner, so it must never run as part of the
// cross-OS/cross-engine functional matrix. Run it with `npm run test:visual`
// (compare) or `npm run test:visual:update` (regenerate baselines — CI only).
//
// Same zero-dependency static server as the functional config; nothing here
// enters the served page.

const { defineConfig, devices } = require("@playwright/test");

// Distinct default port from the functional config (8123) so both can run
// without colliding on a developer machine.
const PORT = Number(process.env.E2E_VISUAL_PORT || 8124);
const BASE_URL = `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: "./tests/visual",
  testMatch: "**/*.visual.spec.js",
  // A pixel diff here is a real regression, not load-order noise — no retries.
  // CI gets one only to absorb browser-launch jitter.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  // Commit baselines under tests/visual/__screenshots__/<name>-<platform>.png.
  // The {platform} token is what makes the committed set unambiguously the
  // ubuntu (-linux) baselines; a run on any other OS diffs against them rather
  // than silently overwriting.
  snapshotPathTemplate: "tests/visual/__screenshots__/{arg}-{platform}{ext}",
  expect: {
    toHaveScreenshot: {
      // Small tolerance for sub-pixel anti-aliasing on identical-platform runs;
      // a real layout/colour change moves far more than this.
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    },
  },
  // Chromium only — see the header. Font hinting differs enough between engines
  // that a WebKit baseline would be a second, near-duplicate set of PNGs with no
  // added regression-catching power. (WebKit visual coverage is 3.11 if wanted.)
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `node tools/static-server.js --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
});
