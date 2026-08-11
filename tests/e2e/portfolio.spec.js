// End-to-end for the PORTFOLIO browser path — the residual the 3.10 coverage
// waiver marked "accepted-but-unverified" (js/base/downloads.js + portfolio.js):
// openAppPortfolio, onPortfolioMessage, switchPortfolioTab, sortPortfolioApps,
// togglePortfolioFilter, downloadAppCsv, exportPortfolioWorkbook. The pure model
// (buildPortfolioModel, the CSV/XLSX builders) is pinned by export/portfolio-test.js
// and export/xlsx-structural-test.js; what only a real browser exercises is the
// cross-window handoff and the dashboard's tab/sort/filter/download plumbing.
//
// Two tests:
//   1. The full happy path through the real "Open App Portfolio" button — a
//      popup window, the dashboard render, and every interactive control.
//   2. onPortfolioMessage in isolation: openAppPortfolio delivers via BOTH a
//      localStorage copy (the fast path) AND postMessage; for a small estate the
//      localStorage copy wins, so it would mask a broken message handler. Test 2
//      clears the storage key at the child's document-start, forcing the
//      postMessage path so onPortfolioMessage is the only thing that can render.
//
// Plant-confirm: each of the seven functions, neutered, must fail the case that
// names it (and Test 1 must stay green when only onPortfolioMessage is broken,
// proving Test 2 is the thing that guards it).

const path = require("path");
const { test, expect } = require("@playwright/test");

const FIXTURE = path.join(__dirname, "fixtures", "portfolio-sample.csv");
const STORAGE_KEY = "cloudInstanceRecommenderPortfolioData";

// Drive aws.html to a generated run whose results carry named apps, then click
// "Open App Portfolio" and return the opened dashboard window.
async function openPortfolioPopup(page) {
  await page.goto("/aws.html");
  await page.waitForFunction(() => window.AWS_DATA_READY === true);
  await page.setInputFiles("#csvFile", FIXTURE);
  await page.click("button.generate-btn");
  await expect(page.locator("#downloadSection")).toBeVisible({
    timeout: 15000,
  });

  // The button appears only when results carry at least one named app.
  const openBtn = page.locator("#openAppPortfolioBtn");
  await expect(openBtn).toBeVisible();

  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    openBtn.click(),
  ]);
  await popup.waitForLoadState();
  return popup;
}

test("app portfolio: open → tabs, sort, filter, per-app CSV, Excel export", async ({
  page,
}) => {
  const popup = await openPortfolioPopup(page);

  // The dashboard rendered from the handoff payload (openAppPortfolio).
  const content = popup.locator("#portfolioContent");
  await expect(content).toBeVisible();
  // Two apps → an overview tab plus two app tabs.
  await expect(popup.locator(".pf-tab")).toHaveCount(3);

  // ── switchPortfolioTab ───────────────────────────────────────────────────────
  await popup.click('.pf-tab[data-tab="app-0"]');
  await expect(popup.locator("#pf-panel-app-0")).toHaveClass(/active/);
  await expect(popup.locator('.pf-tab[data-tab="app-0"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // ── downloadAppCsv (from the now-active app panel) ───────────────────────────
  const appCsvPromise = popup.waitForEvent("download");
  await popup.click('#pf-panel-app-0 button:has-text("App CSV")');
  const appCsv = await appCsvPromise;
  expect(appCsv.suggestedFilename()).toMatch(/^portfolio_.*\.csv$/);

  // Back to the overview for the table-level controls.
  await popup.click('.pf-tab[data-tab="overview"]');
  await expect(popup.locator("#pf-panel-overview")).toHaveClass(/active/);

  // ── sortPortfolioApps (aria-sort must change on the clicked header) ──────────
  const vmsTh = popup.locator('#pf-app-table th[data-sort="vms"]');
  const beforeSort = (await vmsTh.getAttribute("aria-sort")) || "none";
  await vmsTh.click();
  await expect(vmsTh).not.toHaveAttribute("aria-sort", beforeSort);

  // ── togglePortfolioFilter (No-match only hides the all-matching rows) ────────
  const tbodyRows = popup.locator("#pf-app-tbody tr");
  const beforeFilter = await tbodyRows.count();
  expect(beforeFilter).toBe(2);
  await popup.click('label:has-text("No-match only") input[type="checkbox"]');
  // The filter hides the fully-matching app(s), so strictly fewer rows remain.
  await expect(tbodyRows).not.toHaveCount(beforeFilter);
  expect(await tbodyRows.count()).toBeLessThan(beforeFilter);
  await popup.click('label:has-text("No-match only") input[type="checkbox"]');
  await expect(tbodyRows).toHaveCount(beforeFilter); // unchecking restores them

  // ── exportPortfolioWorkbook (async XLSX build + download) ─────────────────────
  const xlsxPromise = popup.waitForEvent("download");
  await popup.click("#pfExportBtn");
  const xlsx = await xlsxPromise;
  expect(xlsx.suggestedFilename()).toMatch(/^app_portfolio_.*\.xlsx$/);
});

test("app portfolio: postMessage handoff renders when localStorage is unavailable (onPortfolioMessage)", async ({
  page,
  context,
}) => {
  // Force the postMessage channel: remove the localStorage copy at every page's
  // document-start. On aws.html this is a no-op (the key isn't set until the
  // button click); on the popup it runs before portfolio.js reads storage, so
  // loadPortfolioFromStorage finds nothing and only onPortfolioMessage —
  // fed by openAppPortfolio's ready/data handshake — can deliver the payload.
  await context.addInitScript((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      /* storage blocked — nothing to remove */
    }
  }, STORAGE_KEY);

  const popup = await openPortfolioPopup(page);

  // If onPortfolioMessage failed to deliver, the dashboard would stay on its
  // empty state; a rendered app table proves the message path worked.
  await expect(popup.locator("#portfolioContent")).toBeVisible();
  await expect(popup.locator("#pf-app-tbody tr")).toHaveCount(2);
  // And the storage copy really was gone, so this could only be postMessage.
  const stored = await popup.evaluate(
    (key) => window.localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(stored).toBeNull();
});
