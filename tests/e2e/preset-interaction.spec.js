// End-to-end for the PRESET-interaction browser path — the residual the 3.10
// coverage waiver marked "accepted-but-unverified" (js/base/presets.js):
// onPresetNameKeydown, importPresets, handlePresetImportFile. Their computed
// cores (validate/merge/apply) are pinned by ui/presets-test.js; what only a
// real browser exercises is the keyboard wiring on the name field and the
// hidden-file-input → FileReader path. This spec drives exactly those.
//
// Like every guard in this line it must be plant-confirmed: break one of the
// three functions (e.g. make onPresetNameKeydown ignore Enter, or make
// handlePresetImportFile a no-op) and the matching case must go RED.

const path = require("path");
const { test, expect } = require("@playwright/test");

const IMPORT_FIXTURE = path.join(__dirname, "fixtures", "presets-import.json");

// The presets bar renders on DOMContentLoaded, independent of any upload, so
// these cases need no CSV — they act on the filter-preset controls directly.
test.describe("aws.html: filter-preset interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/aws.html");
    // The "Save current as…" button is part of the rendered bar; waiting on it
    // is a proxy for "renderPresetsBar has run".
    await expect(page.locator("#presetSaveAsBtn")).toBeVisible();
  });

  test("Enter in the name field saves the preset (onPresetNameKeydown)", async ({
    page,
  }) => {
    await page.click("#presetSaveAsBtn");
    const name = page.locator("#presetNameInput");
    await expect(name).toBeVisible();
    await name.fill("e2e-enter-preset");

    // The load-bearing action: Enter must route through onPresetNameKeydown →
    // confirmSavePreset → writePreset. A broken keydown handler leaves the
    // status empty and the select unchanged, and both asserts below fail.
    await name.press("Enter");

    await expect(page.locator("#presetStatus")).toHaveText(
      'Saved "e2e-enter-preset".',
    );
    await expect(page.locator("#presetSelect")).toHaveValue("e2e-enter-preset");
  });

  test("Escape in the name field cancels the save form (onPresetNameKeydown)", async ({
    page,
  }) => {
    await page.click("#presetSaveAsBtn");
    const form = page.locator("#presetSaveForm");
    const name = page.locator("#presetNameInput");
    await expect(name).toBeVisible();
    await name.fill("should-not-be-saved");

    // Escape routes through onPresetNameKeydown → cancelSavePreset: the inline
    // form re-hides and the opener returns. A broken handler leaves the form
    // open, so the visibility asserts fail.
    await name.press("Escape");

    await expect(form).toBeHidden();
    await expect(page.locator("#presetSaveAsBtn")).toBeVisible();
    // Nothing was persisted, so the select never gained the option.
    await expect(
      page.locator("#presetSelect option", { hasText: "should-not-be-saved" }),
    ).toHaveCount(0);
  });

  test("Import opens the file picker and applies the file (importPresets + handlePresetImportFile)", async ({
    page,
  }) => {
    // Clicking 📥 Import must call importPresets, which triggers the hidden
    // <input type=file>.click(); catching the filechooser proves that wiring.
    const chooserPromise = page.waitForEvent("filechooser");
    await page.click('button:has-text("📥 Import")');
    const chooser = await chooserPromise;

    // Setting files fires the input's change → handlePresetImportFile →
    // FileReader → applyPresetImportText, which merges + re-renders the bar.
    await chooser.setFiles(IMPORT_FIXTURE);

    await expect(page.locator("#presetStatus")).toContainText(
      "Imported 1 preset(s)",
    );
    // The merged preset is now selectable.
    await expect(
      page.locator("#presetSelect option", {
        hasText: "e2e-imported-preset",
      }),
    ).toHaveCount(1);
    // NOTE: handlePresetImportFile also resets the input value so re-picking the
    // SAME file re-fires change. That reset is NOT verifiable here — Playwright's
    // setFiles force-dispatches change regardless of the value, so a broken reset
    // would still pass. It is verified in a node suite instead (ui/presets-test.js,
    // "import resets the file input"), where the event object is controllable.
  });
});
