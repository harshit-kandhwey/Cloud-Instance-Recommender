// End-to-end: the "Download Excel Template" control on each tool page saves the
// committed workbook byte for byte. A plain download link has no script behind
// it, so a wrong path, a missing `download` attribute or a server that rewrites
// the file shows up only in a real browser.

const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const TEMPLATE = "cloud_instance_recommender_template.xlsx";
const committed = fs.readFileSync(
  path.join(__dirname, "..", "..", "assets", "templates", TEMPLATE),
);

for (const name of ["aws", "azure", "gcp", "multicloud"]) {
  test(`${name}: the Excel template link saves the shipped workbook`, async ({
    page,
  }) => {
    await page.goto(`/${name}.html`);
    // The link sits in a section that is collapsed on a first visit, so a user opens it
    // first; clicking a hidden link waits for a visibility that never comes.
    const header = page.locator(
      '.section-header[data-section-id="sample-template"]',
    );
    if ((await header.getAttribute("aria-expanded")) === "false") {
      await header.click();
    }
    await expect(page.locator("#downloadInputTemplateBtn")).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#downloadInputTemplateBtn").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(TEMPLATE);
    const saved = fs.readFileSync(await download.path());
    expect(saved.length).toBe(committed.length);
    expect(saved.equals(committed)).toBe(true);
  });
}
