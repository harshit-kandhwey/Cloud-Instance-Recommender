// First end-to-end path: aws.html, Chromium, the whole real pipeline in a real
// browser — upload a CSV, read the region-validation chips, generate, and export
// the results CSV, asserting the downloaded file.
//
// This is the standing manual browser-smoke debt starting to be paid down in an
// automated form (PLAN 3.10.3): the Node suites drive functions in a vm; this
// drives the shipped page, the Web Worker, and the download path as a user does.
//
// Like every guard in this minor, it must be plant-confirmed: break the app
// (e.g. make the engine emit no instance, or the chip renderer drop the fuzzy
// arrow) and this spec must go RED. A green E2E that would pass against a broken
// app is the defect this whole minor exists to eliminate.

const path = require("path");
const { test, expect } = require("@playwright/test");
const { exportResultsCsv } = require("./helpers");

const FIXTURE = path.join(__dirname, "fixtures", "aws-sample.csv");
// A real AWS instance type: family letter+gen, optional suffix, a dotted size.
// Matches m6g.xlarge, t4g.small, r8i-flex.2xlarge, m5.metal, u-6tb1.112xlarge —
// but never a bare region or VM name. This spec keeps the tighter POSITIVE match
// (the sibling provider specs use the provider-agnostic expectSized instead,
// since Azure/GCP names don't share one shape). The family alternation includes
// the high-memory `u-*` types and the size alternation includes `metal`, so a
// data refresh that legitimately returns either shape does not turn this red.
// Anchored both ends ($ not \b) so a malformed value like "m5.large-extra" cannot
// pass on a prefix match; the xlarge multiplier is (?:[1-9]\d*)? so "m5.0xlarge"
// (a leading-zero size that AWS never emits) is rejected too.
const AWS_INSTANCE =
  /^(?:u-[\w]+|[a-z]\d[a-z]*(?:-[a-z]+)?)\.(?:nano|micro|small|medium|large|metal|(?:[1-9]\d*)?xlarge)$/;

test("aws.html: upload → region chips → generate → export results CSV", async ({
  page,
}) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto("/aws.html");

  // The manifest sets this once the region catalogue is available; validation
  // and generation both depend on it, so wait rather than race the upload.
  await page.waitForFunction(() => window.AWS_DATA_READY === true);

  // Upload the fixture. The input is visually a styled label, but setInputFiles
  // drives the underlying <input type=file> directly.
  await page.setInputFiles("#csvFile", FIXTURE);

  // ── Region validation chips ────────────────────────────────────────────────
  const chips = page.locator("#regionValidationSection");
  await expect(chips).toBeVisible();
  // Exact regions carry a check; the AZ-suffixed one is fuzzy-resolved and shows
  // the arrow to the region it snapped to. Asserting the arrow specifically is
  // what makes a broken fuzzy-resolver fail here.
  await expect(chips).toContainText("us-east-1 ✓");
  await expect(chips).toContainText("us-west-2 ✓");
  await expect(chips).toContainText("us-east-1a → us-east-1");

  // ── Generate ───────────────────────────────────────────────────────────────
  await page.click("button.generate-btn");

  // The download section unhides only after a successful run.
  const downloadSection = page.locator("#downloadSection");
  await expect(downloadSection).toBeVisible({ timeout: 15000 });

  // ── CSV menu opens and closes ────────────────────────────────────────────────
  // Regression: .csv-menu's display:flex once overrode the generic .hidden rule at
  // equal specificity, so the checklist rendered expanded on every run and the
  // toggle could not close it. It must start hidden, open on click, and contract
  // again on a second click.
  const csvMenu = page.locator("#csvMenu");
  await expect(csvMenu).toBeHidden();
  await page.click("#csvMenuBtn");
  await expect(csvMenu).toBeVisible();
  await page.click("#csvMenuBtn");
  await expect(csvMenu).toBeHidden();

  // ── Export the results CSV ───────────────────────────────────────────────────
  // "Results CSV" is checked by default in the CSV menu; open it and download.
  const { filename, rows } = await exportResultsCsv(page);
  expect(filename).toMatch(/^instance_recommendations_.*\.csv$/);

  const names = rows.map((r) => r["VM Name"]);
  // Every input row survived the round trip.
  expect(names).toEqual(["web-server-01", "db-server-02", "app-server-03"]);

  // The load-bearing assertion: the recommendation column for a known row holds
  // a real sized instance, proving the engine ran end to end rather than echoing
  // sample data. Read the exact cell, not "an instance somewhere in the file" —
  // a coarse match would pass even if this column were blanked while a sibling
  // strategy column still emitted one.
  const web01 = rows.find((r) => r["VM Name"] === "web-server-01");
  expect(web01["AWS Like-to-Like Instance"]).toMatch(AWS_INSTANCE);

  // The shipped page must load and run clean.
  expect(consoleErrors).toEqual([]);
});
