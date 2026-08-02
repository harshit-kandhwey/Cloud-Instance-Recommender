// End-to-end: the .xlsx read path AND the column-mapping panel, together, on
// aws.html. The fixture is a real workbook (generated with the vendored SheetJS)
// whose CPU column is headed "Proc Units" — a name the auto-matcher can't map to
// the required "CPU Count" canonical, which forces the mapping panel. So one
// flow exercises: SheetJS lazy-load + binary read → panel → manual mapping →
// generate → export.

const path = require("path");
const { test, expect } = require("@playwright/test");
const { exportResultsCsv, expectSized } = require("./helpers");

const FIXTURE = path.join(__dirname, "fixtures", "aws-mapping.xlsx");

test("aws.html: xlsx upload → mapping panel → confirm → generate → export", async ({
  page,
}) => {
  const consoleErrors = [];
  page.on(
    "console",
    (m) => m.type() === "error" && consoleErrors.push(m.text()),
  );
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto("/aws.html");
  await page.waitForFunction(() => window.AWS_DATA_READY === true);

  // Uploading the .xlsx lazily loads the vendored SheetJS parser, reads the
  // workbook, and hands the rows to the same ingest path a CSV uses.
  await page.setInputFiles("#csvFile", FIXTURE);

  // The unmatched required CPU column forces the mapping panel open.
  const panel = page.locator("#columnMappingSection");
  await expect(panel).toBeVisible({ timeout: 15000 });

  // CPU Count is the one field the matcher left unassigned; its select defaults
  // to "— not present —". Generation stays gated until it is mapped: prove that,
  // then map "Proc Units" onto it.
  const cpuSelect = panel.locator('select[data-canonical="CPU Count"]');
  await expect(cpuSelect).toHaveValue(""); // "— not present —"
  await cpuSelect.selectOption({ label: "Proc Units" });

  await page.click('button:has-text("Confirm Mapping")');

  // With the mapping applied, the panel closes and the region chips render.
  await expect(panel).toBeHidden();
  await expect(page.locator("#regionValidationSection")).toContainText(
    "us-east-1 ✓",
  );

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
  // The mapped-in CPU value (4 vCPU, from the "Proc Units" column) flowed all
  // the way through: a real instance was sized. If the mapping had silently
  // dropped, the engine would have no vCPU to size against.
  const web01 = rows.find((r) => r["VM Name"] === "web-server-01");
  expect(web01["CPU Count"]).toBe("4");
  expectSized(web01["AWS Like-to-Like Instance"]);

  expect(consoleErrors).toEqual([]);
});
