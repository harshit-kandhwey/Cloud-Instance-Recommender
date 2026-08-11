// End-to-end for the SCENARIO-comparison browser path — the residual the 3.10
// coverage waiver marked "accepted-but-unverified" (js/base/scenario-compare.js):
// compareScenarios and downloadScenarioComparison. The CSV builders they call
// (buildScenarioComparisonCsv / …N) are pinned by export/scenario-compare-test.js;
// what only a real browser exercises is the ≥2-pinned guard + DOM render behind
// the Compare button and the anchor-download behind the export button. This spec
// drives exactly those, through a real generate → pin → pin → compare → export.
//
// Plant-confirm: neutering compareScenarios must fail the compare case; neutering
// downloadScenarioComparison must fail the export case.

const path = require("path");
const { test, expect } = require("@playwright/test");
const { parseCsv } = require("./helpers");

const FIXTURE = path.join(__dirname, "fixtures", "aws-sample.csv");
// Two pins of the same run → identical config, so the comparison renders this
// deterministic note. A stable anchor that only appears once renderScenario-
// Comparison has actually run.
const SAME_CONFIG_NOTE = "Both runs used the same filter configuration.";

test("aws.html: generate → pin twice → compare → export comparison CSV", async ({
  page,
}) => {
  await page.goto("/aws.html");
  await page.waitForFunction(() => window.AWS_DATA_READY === true);

  await page.setInputFiles("#csvFile", FIXTURE);
  await page.click("button.generate-btn");
  await expect(page.locator("#downloadSection")).toBeVisible({ timeout: 15000 });

  // The scenario bar unhides only after a successful run (generate.js →
  // updateScenarioCompare).
  const section = page.locator("#scenarioCompareSection");
  await expect(section).toBeVisible();

  // ── Pin two runs ─────────────────────────────────────────────────────────────
  // The name field is read-and-cleared by scenarioNewName on each pin, so fill it
  // fresh before each click.
  await page.fill("#scenarioNameInput", "Run-A");
  await page.click('button:has-text("📌 Pin this run")');
  await page.fill("#scenarioNameInput", "Run-B");
  await page.click('button:has-text("📌 Pin this run")');

  // Both chips are present.
  await expect(section.locator(".scenario-slot")).toHaveCount(2);

  // ── Compare (isolate compareScenarios) ───────────────────────────────────────
  // The second pin auto-renders the comparison; blank the result so the assertion
  // depends on the Compare button routing through compareScenarios, not on the
  // pin's auto-render.
  const result = page.locator("#scenarioCompareResult");
  await expect(result).toContainText(SAME_CONFIG_NOTE);
  await result.evaluate((el) => (el.innerHTML = ""));
  await expect(result).not.toContainText(SAME_CONFIG_NOTE);

  await page.click('button:has-text("Compare")');
  await expect(result).toContainText(SAME_CONFIG_NOTE);

  // ── Export the comparison CSV (downloadScenarioComparison) ───────────────────
  const downloadPromise = page.waitForEvent("download");
  await page.click('button:has-text("Export comparison CSV")');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^scenario_comparison_.*\.csv$/);

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const rows = parseCsv(Buffer.concat(chunks).toString("utf8"));
  // A real comparison CSV: at least one data row for the three input VMs.
  expect(rows.length).toBeGreaterThan(0);
});
