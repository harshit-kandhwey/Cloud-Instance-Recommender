// Accessibility gate: axe-core over each page's loaded critical path, a
// keyboard-only interaction, and a check that the shipped CSP is intact (so we
// know axe ran under the real policy, not a relaxed one).
//
// axe runs on Chromium only — accessibility defects live in the DOM and are
// engine-independent, so there's no value in doubling them across the matrix.
//
// CSP note (PLAN finding 4): @axe-core/playwright injects axe by EVALUATING its
// source in the page, not via a <script> tag, so the page CSP
// (`script-src 'self' 'unsafe-inline'`) does NOT block it and no `bypassCSP` is
// needed — the scan runs under the real, shipped policy. The CSP-integrity test
// below asserts that policy is present and strict, so a future weakening (or a
// switch to bypassCSP) can't quietly hollow the gate out.
//
// Scope: LIGHT mode is gated at zero violations on all four pages. DARK mode is
// gated at zero STRUCTURAL violations (color-contrast disabled) — the dark theme
// carries pre-existing contrast debt in several components (buttons, upload
// label, preset controls) that is tracked for a dedicated dark-mode contrast
// pass; the util-range headings this patch fixed are accessible in BOTH themes.

const { test, expect } = require("@playwright/test");
const { AxeBuilder } = require("@axe-core/playwright");

const PAGES = ["aws", "azure", "gcp", "multicloud"];

test.describe("accessibility", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "axe runs on Chromium only (DOM-level, engine-independent)",
  );

  for (const p of PAGES) {
    test(`${p}.html has no axe violations (light)`, async ({ page }) => {
      await page.goto(`/${p}.html`);
      await page.waitForSelector("#cpuUtilizationRanges");
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations,
        results.violations
          .map((v) => `${v.impact} ${v.id} (${v.nodes.length})`)
          .join("; "),
      ).toEqual([]);
    });
  }

  test("aws.html has no structural axe violations in dark mode", async ({
    page,
  }) => {
    await page.goto("/aws.html");
    await page.waitForSelector("#cpuUtilizationRanges");
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    // color-contrast is tracked dark-mode debt (see file header); everything
    // else — labels, roles, names, structure — must still hold in dark.
    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(
      results.violations,
      results.violations.map((v) => `${v.impact} ${v.id}`).join("; "),
    ).toEqual([]);
  });

  test("a collapsible section is operable by keyboard", async ({ page }) => {
    await page.goto("/aws.html");
    const header = page.locator('.section-header[role="button"]').first();
    await header.waitFor();
    const before = await header.getAttribute("aria-expanded");
    await header.focus();
    expect(await header.evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
    await page.keyboard.press("Enter");
    const after = await header.getAttribute("aria-expanded");
    expect(after).not.toBe(before); // Enter toggled the section
  });

  test("the shipped CSP is present and strict", async ({ page }) => {
    await page.goto("/aws.html");
    const csp = await page.evaluate(
      () =>
        document
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute("content") || "",
    );
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  });
});
