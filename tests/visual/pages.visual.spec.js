// Depth gate C — visual regression. Pins the rendered look of the four provider
// pages in their empty, pre-upload state so an accidental CSS/layout regression
// (a collapsed panel, a shifted control, a colour-token change) fails here even
// when every functional assertion still passes.
//
// Why a SEPARATE config/dir/CI job (playwright-visual.config.js, tests/visual/,
// the `visual` job) instead of folding into the happy-path e2e run:
//
//   * Pixel baselines are OS- and engine-specific. The committed baselines are
//     the `-linux` set generated on the ubuntu CI runner (see tests/README.md);
//     a Windows or WebKit run would diff against them purely on font hinting.
//     So this gate is chromium-only and its baselines are produced on CI, never
//     on a contributor's machine.
//   * Keeping it out of `npm run test:e2e` means the functional matrix stays
//     green and fast on any OS; the visual gate runs only where its baselines
//     are valid.
//
// Plant-confirm, like every guard in this minor: change a page's layout or a
// colour token and this spec must go RED. A green visual run against a visibly
// broken page is exactly the failure this gate exists to catch.

const { test, expect } = require("@playwright/test");

// The empty initial state is deterministic: no upload has happened, and the
// pages render no timestamp, version string, or random id on load (verified),
// so a full-page screenshot is stable across runs on the same platform.
const PAGES = [
  { name: "aws", file: "aws.html", ready: ["AWS_DATA_READY"] },
  { name: "azure", file: "azure.html", ready: ["AZURE_DATA_READY"] },
  { name: "gcp", file: "gcp.html", ready: ["GCP_DATA_READY"] },
  // multicloud loads all three catalogues at once, so it is ready only when
  // every provider flag is set — the same gate its happy-path spec waits on.
  {
    name: "multicloud",
    file: "multicloud.html",
    ready: ["AWS_DATA_READY", "AZURE_DATA_READY", "GCP_DATA_READY"],
  },
];

for (const { name, file, ready } of PAGES) {
  test(`${file}: empty-state visual baseline`, async ({ page }) => {
    await page.goto(`/${file}`);

    // Wait for the data catalogues so the screenshot captures the fully wired
    // page, not a mid-hydration frame that would differ run to run.
    await page.waitForFunction(
      (flags) => flags.every((f) => window[f] === true),
      ready,
    );

    // A clean base name (no ".html", which the path template would mistake for
    // an extension); the config's snapshotPathTemplate adds the -linux suffix so
    // the ubuntu baselines never collide with a locally generated set.
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      // Animations off so a transition caught mid-flight can't flake the diff.
      animations: "disabled",
    });
  });
}
