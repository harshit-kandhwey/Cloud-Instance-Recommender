// End-to-end: the Browser Storage section (3.21 phase 1 and 2) as a user meets it in
// a real browser. Covered: every owned key is listed; clearing one key is two-step
// and removes only that key; saving a snapshot before any run is refused with a
// visible message. The save-after-a-run path needs generated results and is left
// to a later spec.

const { test, expect } = require("@playwright/test");

const MANUAL_KEY = "cloudInstanceRecommenderManualVMs";
const FOREIGN_KEY = "someOtherAppsKey";

test("the storage section lists all nine owned keys", async ({ page }) => {
  await page.goto("/aws.html");
  await expect(page.locator("#storageSection")).toBeVisible();
  await expect(page.locator("#storageManagerPanel tbody tr")).toHaveCount(9);
});

test("clearing one key is two-step and touches only that key", async ({
  page,
}) => {
  await page.goto("/aws.html");
  await page.evaluate(
    ([owned, foreign]) => {
      localStorage.setItem(owned, "[]");
      localStorage.setItem(foreign, "keep me");
    },
    [MANUAL_KEY, FOREIGN_KEY],
  );
  await page.reload();

  const row = page.locator("#storageManagerPanel tr", { hasText: MANUAL_KEY });
  const clear = row.getByRole("button", { name: "Clear", exact: true });
  await clear.click();
  await expect(
    row.getByRole("button", { name: "Confirm clear", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate((k) => localStorage.getItem(k), MANUAL_KEY),
  ).not.toBeNull();

  await row.getByRole("button", { name: "Confirm clear", exact: true }).click();
  await expect(page.locator("#storageManagerStatus")).toHaveText("Cleared.");
  expect(
    await page.evaluate((k) => localStorage.getItem(k), MANUAL_KEY),
  ).toBeNull();
  expect(await page.evaluate((k) => localStorage.getItem(k), FOREIGN_KEY)).toBe(
    "keep me",
  );
});

test("a snapshot saved before any run is refused with a visible reason", async ({
  page,
}) => {
  await page.goto("/aws.html");
  await page
    .getByLabel("Snapshot name", { exact: true })
    .fill("Before any run");
  await page
    .getByRole("button", { name: "Save snapshot", exact: true })
    .click();
  await expect(page.locator("#fleetSnapshotStatus")).toHaveText(
    "Generate a run before saving a snapshot.",
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem("cloudInstanceRecommenderFleetSnapshots"),
    ),
  ).toBeNull();
});
