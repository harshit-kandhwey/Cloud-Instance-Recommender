// End-to-end: the PWA wiring that only a real browser can exercise — that the
// service worker actually REGISTERS and takes CONTROL of the page, and that the
// offline indicator surfaces when the network really drops.
//
// Scope note (deliberate): this does NOT assert the SW serves specific bytes
// from cache offline. Two things make that untestable here — the page's CSP
// (`connect-src 'none'`) blocks any `fetch()` from page script, and Chromium
// serves an offline navigation + its subresources of an already-visited page
// from its own internal caches even when the SW's `respondWith` would fail, so a
// "loads offline" assertion passes even against a broken SW (no teeth). The
// SW's cache-serving/stale-while-revalidate/offline-fallback LOGIC is covered,
// and plant-confirmed, by the Node suite tests/suites/infra/pwa-test.js, which
// drives sw.js directly with mocked caches. This spec covers the real-browser
// registration + indicator that the mock cannot.
//
// Chromium-only (the E2E matrix is Chromium here).

const { test, expect } = require("@playwright/test");

test("service worker registers and controls the page; offline indicator shows", async ({
  page,
  context,
}) => {
  await page.goto("/aws.html");

  // pwa-register.js registers sw.js on window `load`; the SW then installs,
  // activates, and claims this client. Controller becoming non-null proves the
  // whole real-browser registration path worked (nothing the Node mock can do).
  await page.waitForFunction(
    () =>
      navigator.serviceWorker && navigator.serviceWorker.controller !== null,
    null,
    { timeout: 20000 },
  );

  // The registration resolves to an active worker scoped to the site root.
  const swInfo = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { hasActive: !!(reg && reg.active), scope: reg && reg.scope };
  });
  expect(swInfo.hasActive).toBe(true);
  expect(swInfo.scope).toMatch(/\/$/);

  // Drop the network: the app's offline indicator (pwa-register.js listens on
  // the `offline` event) must surface.
  await context.setOffline(true);
  await expect(page.locator("#offlineBanner")).toBeVisible();
  await expect(page.locator("#offlineBanner")).toContainText(/offline/i);

  // …and retract when the network returns.
  await context.setOffline(false);
  await expect(page.locator("#offlineBanner")).toContainText(/back online/i);
});
