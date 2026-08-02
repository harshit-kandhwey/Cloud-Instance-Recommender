// End-to-end: azure.html on Chromium — upload → region chips → generate →
// export, the Azure sibling of the aws happy path. Same guard discipline: this
// must go RED if the app is broken (see the aws spec's plant notes).

const path = require("path");
const { test, expect } = require("@playwright/test");
const { exportResultsCsv, expectSized } = require("./helpers");

const FIXTURE = path.join(__dirname, "fixtures", "azure-sample.csv");

test("azure.html: upload → region chips → generate → export results CSV", async ({
  page,
}) => {
  const consoleErrors = [];
  page.on(
    "console",
    (m) => m.type() === "error" && consoleErrors.push(m.text()),
  );
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto("/azure.html");
  await page.waitForFunction(() => window.AZURE_DATA_READY === true);
  await page.setInputFiles("#csvFile", FIXTURE);

  // Azure display-name regions resolve exact; the chip echoes the raw CSV value.
  const chips = page.locator("#regionValidationSection");
  await expect(chips).toBeVisible();
  await expect(chips).toContainText("East US ✓");
  await expect(chips).toContainText("West US 2 ✓");
  await expect(chips).toContainText("North Europe ✓");

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
  expectSized(web01["AZURE Like-to-Like Instance"]);

  expect(consoleErrors).toEqual([]);
});
