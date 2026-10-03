// End-to-end: a fleet snapshot saved after a real run, then compared with the last
// run (3.21 phase 2 and 3). The same run is compared with its own snapshot, so the
// estate must match and no compared cell may differ. This exercises the save flow
// and the identity and diff wiring on a live page, which the Node suites cannot.

const path = require("path");
const { test, expect } = require("@playwright/test");

const FIXTURE = path.join(__dirname, "fixtures", "aws-sample.csv");

test("a snapshot of the last run compares as the same estate with no changes", async ({
  page,
}) => {
  await page.goto("/aws.html");
  await page.waitForFunction(() => window.AWS_DATA_READY === true);
  await page.setInputFiles("#csvFile", FIXTURE);
  await page.click("button.generate-btn");
  await expect(page.locator("#downloadSection")).toBeVisible({
    timeout: 15000,
  });

  await page.getByLabel("Snapshot name", { exact: true }).fill("Baseline");
  await page
    .getByRole("button", { name: "Save snapshot", exact: true })
    .click();
  await expect(page.locator("#fleetSnapshotStatus")).toContainText(
    'Saved "Baseline".',
  );

  await page
    .getByRole("button", { name: "Compare with last run", exact: true })
    .click();
  const status = page.locator("#fleetSnapshotStatus");
  await expect(status).toContainText("Same estate (100% of VMs in common)");
  await expect(status).toContainText("0 added, 0 removed.");
  await expect(page.locator("#fleetSnapshotsPanel")).toContainText(
    "0 VMs changed",
  );
});
