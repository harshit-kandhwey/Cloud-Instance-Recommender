// The instance-family-name filter, driven as a user does: open the Advanced
// Filtering section, tick "Restrict to specific instance family names", tick one
// name, generate, and read the Family column back. The engine, presets and
// scenario diff always honoured this option; it went unreachable because no page
// rendered the checkbox, so this spec asserts the whole path from the click.
//
// Plant-confirm: break the wiring (e.g. rename the checkbox id in one page, or make
// getSelectedInstanceFamilyNames return []) and the matching case must go RED.

const path = require("path");
const { test, expect } = require("@playwright/test");
const { exportResultsCsv } = require("./helpers");

const CASES = [
  { page: "aws", flag: "AWS_DATA_READY", name: "Memory optimized" },
  { page: "azure", flag: "AZURE_DATA_READY", name: "Memory optimized" },
  { page: "gcp", flag: "GCP_DATA_READY", name: "Memory optimized" },
];

for (const c of CASES) {
  test(`${c.page}.html: restricting to "${c.name}" yields only that family`, async ({
    page,
  }) => {
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    await page.goto(`/${c.page}.html`);
    await page.waitForFunction((flag) => window[flag] === true, c.flag);
    await page.setInputFiles(
      "#csvFile",
      path.join(__dirname, "fixtures", `${c.page}-sample.csv`),
    );

    await page.click('[data-section-id="advanced-filters"]');
    await page.check("#restrictInstanceFamilyNames");
    await expect(page.locator("#instanceFamilyNameControls")).toBeVisible();

    // The options are the catalogue's own names: the list must offer this one.
    const box = page.locator(`#familyNameCheckboxes input[value="${c.name}"]`);
    await expect(box).toHaveCount(1);
    await box.check();

    await page.click("button.generate-btn");
    await expect(page.locator("#downloadSection")).toBeVisible({
      timeout: 15000,
    });

    const { rows } = await exportResultsCsv(page);
    const col = `${c.page.toUpperCase()} Like-to-Like Family`;
    const families = rows.map((r) => r[col]);
    expect(families.length).toBeGreaterThan(0);
    // Every sized row is in the ticked family; an unsized row says N/A, never a
    // different family slipping past the restriction.
    for (const f of families) expect(["N/A", c.name]).toContain(f);
    expect(families).toContain(c.name);

    expect(consoleErrors).toEqual([]);
  });
}
