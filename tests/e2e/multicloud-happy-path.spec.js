// End-to-end: multicloud.html on Chromium — the page that loads all three
// providers at once. Upload a CSV with AWS/Azure/GCP region columns, assert the
// chips validate each provider, generate, and export — asserting a sized
// instance in all three Like-to-Like columns. Same guard discipline.

const path = require("path");
const { test, expect } = require("@playwright/test");
const { exportResultsCsv, expectSized } = require("./helpers");

const FIXTURE = path.join(__dirname, "fixtures", "multicloud-sample.csv");

test("multicloud.html: upload → per-provider chips → generate → export", async ({
  page,
}) => {
  const consoleErrors = [];
  page.on(
    "console",
    (m) => m.type() === "error" && consoleErrors.push(m.text()),
  );
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto("/multicloud.html");
  // All three provider catalogues must be ready before validation/generation.
  await page.waitForFunction(
    () =>
      window.AWS_DATA_READY === true &&
      window.AZURE_DATA_READY === true &&
      window.GCP_DATA_READY === true,
  );
  await page.setInputFiles("#csvFile", FIXTURE);

  // The panel groups chips per provider; assert one exact chip from each group.
  // (Region validation runs against every loaded provider, independent of which
  // are selected for output below.)
  const chips = page.locator("#regionValidationSection");
  await expect(chips).toBeVisible();
  await expect(chips).toContainText("us-east-1 ✓"); // AWS
  await expect(chips).toContainText("East US ✓"); // Azure
  await expect(chips).toContainText("us-central1-a ✓"); // GCP

  // Unlike the single-provider pages, multicloud.html requires choosing which
  // providers to size for — generate refuses with a warning if none are checked.
  await page.check("#aws");
  await page.check("#azure");
  await page.check("#gcp");

  await page.click("button.generate-btn");
  await expect(page.locator("#downloadSection")).toBeVisible({
    timeout: 20000,
  });

  const { filename, rows } = await exportResultsCsv(page);
  expect(filename).toMatch(/^instance_recommendations_.*\.csv$/);
  expect(rows.map((r) => r["VM Name"])).toEqual([
    "web-server-01",
    "db-server-02",
    "app-server-03",
  ]);
  // Every provider sized the row — the multicloud run fanned out to all three.
  const web01 = rows.find((r) => r["VM Name"] === "web-server-01");
  expectSized(web01["AWS Like-to-Like Instance"]);
  expectSized(web01["AZURE Like-to-Like Instance"]);
  expectSized(web01["GCP Like-to-Like Instance"]);

  expect(consoleErrors).toEqual([]);
});
