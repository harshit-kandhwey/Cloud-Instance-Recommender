// Depth gate C — visual regression, richer STATES (3.11 expansion of the 3.10
// empty-page baselines). Three states the empty-page gate never captured:
//
//   * dark-mode      — aws.html in the dark theme, so a dark-token regression
//                      (a mis-stepped surface, a broken contrast fix) fails here.
//   * region-chips   — the region-validation component after an upload, so a
//                      change to the chip / fuzzy-arrow rendering is caught.
//   * results-table  — the populated recommendation preview table, so a column,
//                      row, or cell-format regression in real output fails here.
//
// Determinism (the hazard for populated states, per the plan): audited before
// baselining. The engine output is deterministic (the golden gate proves it) and
// neither the region section nor the preview table renders any timestamp, version
// string, or random id (grep-verified: no Date/now/random in preview.js, and the
// only new Date in the render path is exportDateStamp, used for filenames, not the
// DOM). So no masking is needed. Same chromium-only, -linux-baseline rules as the
// empty-page gate (see pages.visual.spec.js / playwright-visual.config.js).
//
// Plant-confirm, like every guard in this minor: shift a token or a layout and the
// matching snapshot must go RED.

const path = require("path");
const { test, expect } = require("@playwright/test");

const AWS_FIXTURE = path.join(
  __dirname,
  "..",
  "e2e",
  "fixtures",
  "aws-sample.csv",
);

async function gotoAwsReady(page) {
  await page.goto("/aws.html");
  await page.waitForFunction(() => window.AWS_DATA_READY === true);
}

test("aws.html: dark-theme empty-state visual baseline", async ({ page }) => {
  await gotoAwsReady(page);
  // Freeze the theme transition so the screenshot is the settled dark state, not
  // a light→dark blend mid-fade (the same 0.3s fade that fooled the a11y scan).
  await page.addStyleTag({
    content:
      "*,*::before,*::after{transition:none!important;animation:none!important}",
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect(page).toHaveScreenshot("aws-dark.png", {
    fullPage: true,
    animations: "disabled",
  });
});

test("aws.html: region-validation chips visual baseline", async ({ page }) => {
  await gotoAwsReady(page);
  await page.setInputFiles("#csvFile", AWS_FIXTURE);
  const chips = page.locator("#regionValidationSection");
  await expect(chips).toBeVisible();
  // The exact-match check and the fuzzy arrow (us-east-1a → us-east-1) must have
  // rendered before the shot, or it would capture a half-built section.
  await expect(chips).toContainText("us-east-1a → us-east-1");
  await expect(chips).toHaveScreenshot("region-chips.png", {
    animations: "disabled",
  });
});

test("aws.html: results preview table visual baseline", async ({ page }) => {
  await gotoAwsReady(page);
  await page.setInputFiles("#csvFile", AWS_FIXTURE);
  await page.click("button.generate-btn");
  await expect(page.locator("#downloadSection")).toBeVisible({
    timeout: 15000,
  });
  const preview = page.locator("#resultsPreviewSection");
  await expect(preview).toBeVisible();
  // The table itself must be in the section before the shot.
  await expect(preview.locator("#_previewTable")).toBeVisible();
  await expect(preview).toHaveScreenshot("results-table.png", {
    animations: "disabled",
  });
});
