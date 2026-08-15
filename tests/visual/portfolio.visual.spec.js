// Depth gate C — visual regression for the APP PORTFOLIO dashboard (3.13 Phase
// D). The empty-page and states specs never covered app-portfolio.html: its
// dashboard only exists after a generated result set is handed off from a tool
// page, so it is reached the same way portfolio.spec.js reaches it — drive
// aws.html to a run with named apps, then open the "Open App Portfolio" popup.
//
// What this pins: the Overview panel — the KPI cards, the estate distribution
// charts (ENV / OS doughnuts + the right-sizing verdict bar added in Phase D),
// the applications table, and the callouts. A doughnut geometry slip, a legend
// or gradient-header regression, or a shifted card fails here.
//
// Determinism: the ONLY dynamic string on the page is the "Generated … " stamp
// in the toolbar (new Date(payload.generatedAt).toLocaleString()). That toolbar
// is a sibling of the tab panels, OUTSIDE #pf-panel-overview, so screenshotting
// the panel captures the whole visualisation without any timestamp — no masking
// needed. Same chromium-only, -linux-baseline rules as the other visual specs.
//
// Plant-confirm, like every guard in this minor: shift a chart token or the
// panel layout and this snapshot must go RED.

const path = require("path");
const { test, expect } = require("@playwright/test");

const FIXTURE = path.join(
  __dirname,
  "..",
  "e2e",
  "fixtures",
  "portfolio-sample.csv",
);

test("app-portfolio.html: overview dashboard visual baseline", async ({
  page,
}) => {
  await page.goto("/aws.html");
  await page.waitForFunction(() => window.AWS_DATA_READY === true);
  await page.setInputFiles("#csvFile", FIXTURE);
  await page.click("button.generate-btn");
  await expect(page.locator("#downloadSection")).toBeVisible({
    timeout: 15000,
  });

  const openBtn = page.locator("#openAppPortfolioBtn");
  await expect(openBtn).toBeVisible();
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    openBtn.click(),
  ]);
  await popup.waitForLoadState();

  // Freeze any theme/tab transition so the shot is the settled state.
  await popup.addStyleTag({
    content:
      "*,*::before,*::after{transition:none!important;animation:none!important}",
  });

  const overview = popup.locator("#pf-panel-overview");
  await expect(overview).toBeVisible();
  // The estate charts must have rendered before the shot — wait on the doughnut
  // SVG so a mid-render frame can't be captured.
  await expect(overview.locator("svg.pf-doughnut").first()).toBeVisible();
  await expect(overview).toHaveScreenshot("portfolio-overview.png", {
    animations: "disabled",
  });
});
