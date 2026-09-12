// Service worker: offline support for the (static) Cloud Instance Recommender.
//
// The app shell (HTML + CSS + manifest + icon) is precached on install so
// navigations work offline. Everything else same-origin (JS modules, provider
// data manifests, lazily-loaded region files, vendored SheetJS, logos) is
// cached at runtime with stale-while-revalidate: served instantly from cache
// and refreshed in the background when online, so instance data stays current
// without a build step.
//
// Bump CACHE to force a clean re-precache on the next visit. A data refresh
// normally does NOT need one — two things do:
//   - it DELETES region files: revalidating a deleted file 404s, so the cached
//     copy would be served forever;
//   - the SHAPE of the data changes: stale-while-revalidate can hand a client
//     that already has the new loader a region file in the old format. Today the
//     loader merges such a file to itself and nothing breaks, but that is
//     accidental resilience, not a property anyone is maintaining.
// See "Service Worker" in CONTRIBUTING.md.
//
// CSP note: the page's `connect-src 'none'` restricts fetch/XHR from the page,
// not the service worker — the SW's own fetches run in the worker context
// (GitHub Pages sends no CSP header for sw.js), so caching works. Lazy region
// loading via <script> injection is intercepted here and served from cache.

// Bumped v2 -> v3: css/ renamed to styles/ and manifest.json/icon.svg moved
// into public/, so several PRECACHE keys below changed — a same-name cache
// would keep the old keys around forever unused (activate only deletes whole
// OTHER cache names, never prunes stale keys within one), so this forces a
// clean re-precache instead of accumulating dead entries.
const CACHE = "cir-cache-v3";

// Kept small and stable — anything missed here is still runtime-cached on first
// online visit. cache.add is per-file so one bad path can't abort the precache.
//
// PRECACHE_SCRIPTS is the union of every <script src="src/...">  multicloud.html
// loads (every provider + every shared module) plus portfolio.js (only
// app-portfolio.html loads it) — a superset of what ANY tool page needs, so a
// genuinely first-ever offline navigation (before any online visit populated
// the runtime cache) still has a full application runtime to run, not just a
// cached page shell with nothing to execute. Confirmed a superset via a
// one-off script-tag diff against aws/azure/gcp/app-portfolio/index/user-guide;
// re-check if a new page or module is added.
const PRECACHE_SCRIPTS = [
  "src/core/rules/rule-engine.js",
  "src/core/rules/user-rules.js",
  "src/core/engine/base-instance-selector.js",
  "src/providers/aws/aws-data.js",
  "src/providers/azure/azure-data.js",
  "src/providers/gcp/gcp-data.js",
  "src/providers/aws/aws-instance-selector.js",
  "src/providers/azure/azure-instance-selector.js",
  "src/providers/gcp/gcp-instance-selector.js",
  "src/providers/aws/aws-specific.js",
  "src/providers/azure/azure-specific.js",
  "src/providers/gcp/gcp-specific.js",
  "src/core/engine/instance-selector-factory.js",
  "src/shared/app-core.js",
  "src/ui/ui-shell.js",
  "src/features/ingest.js",
  "src/features/manual-entry.js",
  "src/ui/form-controls.js",
  "src/core/engine/generate.js",
  "src/features/preview.js",
  "src/ui/charts.js",
  "src/features/downloads.js",
  "src/features/presets.js",
  "src/ui/user-rules-ui.js",
  "src/features/xlsx-export.js",
  "src/features/scenario-compare.js",
  "src/features/portfolio.js",
];

const PRECACHE = [
  "index.html",
  "aws.html",
  "azure.html",
  "gcp.html",
  "multicloud.html",
  "app-portfolio.html",
  "user-guide.html",
  "styles/theme.css",
  "styles/style.css",
  "styles/index_style.css",
  "styles/portfolio.css",
  "js/pwa-register.js",
  "public/manifest.json",
  "public/icon.svg",
  ...PRECACHE_SCRIPTS,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.allSettled(PRECACHE.map((url) => cache.add(url))),
      ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(staleWhileRevalidate(event));
});

async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      // Only cache complete, same-origin OK responses.
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(network); // refresh in the background
    return cached;
  }
  const net = await network;
  if (net) return net;
  // Offline and uncached: give navigations a cached shell rather than an error.
  if (req.mode === "navigate") {
    return (await cache.match("index.html")) || Response.error();
  }
  return Response.error();
}
