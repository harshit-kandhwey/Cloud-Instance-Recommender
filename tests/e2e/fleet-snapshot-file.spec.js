// End-to-end: a fleet snapshot exported as a file and imported back. The file
// is made and read in the browser, so this drives the real download, the hidden file
// input and the rename form, which the Node suites cannot.

const path = require("path");
const os = require("os");
const fs = require("fs");
const { test, expect } = require("@playwright/test");

const FIXTURE = path.join(__dirname, "fixtures", "aws-sample.csv");

test("a snapshot exports to a file and imports back, and a taken name asks for a new one", async ({
  page,
}) => {
  await page.goto("/aws.html");
  await page.waitForFunction(() => window.AWS_DATA_READY === true);
  await page.setInputFiles("#csvFile", FIXTURE);
  await page.click("button.generate-btn");
  await expect(page.locator("#downloadSection")).toBeVisible({
    timeout: 15000,
  });

  await page.getByLabel("Snapshot name", { exact: true }).fill("Original");
  await page
    .getByRole("button", { name: "Save snapshot", exact: true })
    .click();
  await expect(page.locator("#fleetSnapshotStatus")).toContainText(
    'Saved "Original".',
  );

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export file", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("fleet_snapshot_original.json");
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "cir-snap-")),
    download.suggestedFilename(),
  );
  await download.saveAs(file);
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(doc.format).toBe("cir-fleet-snapshot");
  expect(doc.id).toBeUndefined();

  // Delete the original (two-step), then bring it back from the file.
  const panel = page.locator("#fleetSnapshotsPanel");
  await panel.getByRole("button", { name: "Delete", exact: true }).click();
  await panel
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(page.locator("#fleetSnapshotsPanel")).toContainText(
    "No snapshots saved.",
  );

  await page.setInputFiles("#fleetSnapshotImportFile", file);
  await expect(page.locator("#fleetSnapshotStatus")).toContainText(
    'Imported "Original".',
  );
  await expect(page.locator("#fleetSnapshotsPanel")).toContainText(
    `${doc.rows.length} VMs`,
  );

  // The same file again: the name is taken, so it asks instead of replacing.
  await page.setInputFiles("#fleetSnapshotImportFile", file);
  await expect(page.locator("#fleetSnapshotImportForm")).toBeVisible();
  await expect(page.locator("#fleetSnapshotImportName")).toHaveValue(
    "Original (2)",
  );
  await page
    .getByRole("button", { name: "Import with this name", exact: true })
    .click();
  await expect(page.locator("#fleetSnapshotStatus")).toContainText(
    'Imported "Original (2)".',
  );
});

test("a file that is not a snapshot is refused and nothing is stored", async ({
  page,
}) => {
  await page.goto("/aws.html");
  await page.waitForFunction(() => window.AWS_DATA_READY === true);
  const bad = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "cir-snap-")),
    "not-a-snapshot.json",
  );
  fs.writeFileSync(bad, JSON.stringify({ hello: "world" }));
  await page.setInputFiles("#fleetSnapshotImportFile", bad);
  await expect(page.locator("#fleetSnapshotStatus")).toContainText(
    "not a fleet snapshot",
  );
  await expect(page.locator("#fleetSnapshotsPanel")).toContainText(
    "No snapshots saved.",
  );
});
