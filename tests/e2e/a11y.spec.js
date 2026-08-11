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
// Scope: BOTH themes are gated at zero violations on all four pages, color-contrast
// INCLUDED. 3.10 had disabled color-contrast in dark as "tracked debt"; the 3.11
// dark-contrast pass found that was a false positive, not real debt — the dark
// palette is AA-compliant at rest. The apparent failures came from scanning the
// page MID-TRANSITION: switching data-theme fires the 0.3s theme fade on every
// element, and axe sampled colors part-way between the light and dark tokens
// (e.g. a button caught at #959daa on #363d4e — neither the light nor the settled
// dark value). The dark test now disables transitions before scanning so axe reads
// the settled colors a user actually reads; with that, all four pages pass
// color-contrast in dark with no token changes.

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

  for (const p of PAGES) {
    test(`${p}.html has no axe violations (dark, color-contrast included)`, async ({
      page,
    }) => {
      await page.goto(`/${p}.html`);
      await page.waitForSelector("#cpuUtilizationRanges");
      // Freeze the 0.3s theme transition so axe reads the SETTLED dark colors,
      // not a light→dark blend mid-fade (see file header). The injected <style>
      // is inline; the shipped CSP allows it (style-src 'self' 'unsafe-inline'),
      // so the scan still runs under the real policy — the CSP-integrity test
      // below asserts that policy is intact.
      await page.addStyleTag({
        content:
          "*,*::before,*::after{transition:none!important;animation:none!important}",
      });
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations,
        results.violations
          .map((v) => `${v.impact} ${v.id} (${v.nodes.length})`)
          .join("; "),
      ).toEqual([]);
    });
  }

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
    // Parse the policy into a directive→value map so each assertion is EXACT.
    // A toContain check would also pass a BROADENED directive (e.g. a style-src
    // with an extra allowed host, or 'unsafe-eval' added to script-src) — which
    // is precisely the weakening this gate exists to catch. Exact values also
    // force the future strict-CSP migration (which drops 'unsafe-inline') to
    // update this scan deliberately rather than sliding past a substring match.
    const directives = Object.fromEntries(
      csp
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const sp = d.indexOf(" ");
          return sp === -1 ? [d, ""] : [d.slice(0, sp), d.slice(sp + 1).trim()];
        }),
    );
    expect(directives["default-src"]).toBe("'self'");
    expect(directives["connect-src"]).toBe("'none'");
    expect(directives["script-src"]).toBe("'self' 'unsafe-inline'");
    // style-src must allow 'unsafe-inline': the dark-mode scan injects an inline
    // <style> to freeze transitions, and it must run under the real policy.
    expect(directives["style-src"]).toBe("'self' 'unsafe-inline'");
  });
});
