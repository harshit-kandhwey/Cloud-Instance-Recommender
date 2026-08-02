// End-to-end: gcp.html on Chromium — upload → region chips → generate → export.
// The GCP sibling of the aws happy path; same guard discipline.

const path = require("path");
const { test, expect } = require("@playwright/test");
const { exportResultsCsv, expectSized } = require("./helpers");

const FIXTURE = path.join(__dirname, "fixtures", "gcp-sample.csv");

test("gcp.html: upload → region chips → generate → export results CSV", async ({
  page,
}) => {
  const consoleErrors = [];
  page.on(
    "console",
    (m) => m.type() === "error" && consoleErrors.push(m.text()),
  );
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto("/gcp.html");
  await page.waitForFunction(() => window.GCP_DATA_READY === true);
  await page.setInputFiles("#csvFile", FIXTURE);

  // Zone-suffixed regions (…-a/-b/-c) normalize to their region and resolve
  // exact; the chip echoes the raw CSV value with a check.
  const chips = page.locator("#regionValidationSection");
  await expect(chips).toBeVisible();
  await expect(chips).toContainText("us-central1-a ✓");
  await expect(chips).toContainText("us-west1-b ✓");
  await expect(chips).toContainText("europe-west1-c ✓");

  await page.click("button.generate-btn");
  await expect(page.locator("#downloadSection")).toBeVisible({
    timeout: 15000,
  });

  const { filename, rows } = await exportResultsCsv(page);
  expect(filename).toMatch(/^instance_recommendations_.*\.csv$/);
  expect(rows.map((r) => r["VM Name"])).toEqual([
    "web-server-01",
    "db-server-02",
    "app-server-03",
  ]);
  const web01 = rows.find((r) => r["VM Name"] === "web-server-01");
  expectSized(web01["GCP Like-to-Like Instance"]);

  expect(consoleErrors).toEqual([]);
});
