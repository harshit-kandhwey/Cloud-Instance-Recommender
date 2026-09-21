// multicloud.html's own filter getters, driven as a user does. Kept apart from
// family-name-filter.spec.js because this page installs its own getters for the
// processor and category filters rather than using the shared panels.
//
// Plant-confirm: move the getter assignments in multicloud.html back out of the
// DOMContentLoaded handler and both cases must go RED.

const path = require("path");
const { test, expect } = require("@playwright/test");
const { exportResultsCsv } = require("./helpers");

// multicloud.html installs its own getters for the processor and category
// filters. They were assigned by an inline script that runs BEFORE the deferred
// modules, whose same-named function declarations then overwrote them — so every
// getter returned [] and ticking a restriction restricted nothing.
async function runMulticloudWith(page, tick) {
  await page.goto("/multicloud.html");
  await page.waitForFunction(
    () =>
      window.AWS_DATA_READY === true &&
      window.AZURE_DATA_READY === true &&
      window.GCP_DATA_READY === true,
  );
  await page.setInputFiles(
    "#csvFile",
    path.join(__dirname, "fixtures", "multicloud-sample.csv"),
  );
  await page.check("#aws");
  await page.check("#azure");
  await page.check("#gcp");
  await page.click('[data-section-id="advanced-filters"]');
  await tick();
  await page.click("button.generate-btn");
  await expect(page.locator("#downloadSection")).toBeVisible({
    timeout: 20000,
  });
  return (await exportResultsCsv(page)).rows;
}

const isSized = (v) => v && !/^(?:n\/a|no |error|missing)/i.test(v);

test("multicloud.html: a category restriction is honoured by every provider", async ({
  page,
}) => {
  const rows = await runMulticloudWith(page, async () => {
    await page.check("#restrictMainFamilies");
    await page.check("#mc_cat_general");
  });
  for (const provider of ["AWS", "AZURE", "GCP"]) {
    const sized = rows
      .map((r) => [
        r[`${provider} Like-to-Like Instance`],
        r[`${provider} Like-to-Like Family`],
      ])
      .filter(([instance]) => isSized(instance));
    expect(sized.length, `${provider} sized nothing`).toBeGreaterThan(0);
    // General purpose only: a memory- or compute-optimized pick means the ticked
    // category was ignored.
    for (const [instance, family] of sized) {
      expect(family, `${provider} ${instance}`).toBe("General purpose");
    }
  }
});

// Results carry no processor column to read back, so assert the getter that
// generate.js calls to build the engine's options.
test("multicloud.html: the processor and category getters read the page's controls", async ({
  page,
}) => {
  await page.goto("/multicloud.html");
  await page.waitForFunction(() => window.AWS_DATA_READY === true);
  await page.click('[data-section-id="advanced-filters"]');
  await page.check("#restrictProcessorManufacturers");
  await page.check("#mc_proc_amd");
  await page.check("#restrictMainFamilies");
  await page.check("#mc_cat_memory");
  const got = await page.evaluate(() => ({
    processors: getSelectedProcessorManufacturers(),
    awsFamilies: getSelectedMainFamilies(),
    azureSeries: getSelectedAzureSeries(),
    gcpFamilies: getSelectedGCPFamilies(),
  }));
  expect(got.processors).toEqual(["AMD"]);
  expect(got.awsFamilies.length).toBeGreaterThan(0);
  expect(got.azureSeries).toEqual(["E-series", "M-series"]);
  expect(got.gcpFamilies).toEqual(["M3", "M4"]);
});
