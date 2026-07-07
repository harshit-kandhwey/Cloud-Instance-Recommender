// Service worker: offline support for the (static) Cloud Instance Recommender.
//
// The app shell (HTML + CSS + manifest + icon) is precached on install so
// navigations work offline. Everything else same-origin (JS modules, provider
// data manifests, lazily-loaded region files, vendored SheetJS, logos, PDF) is
// cached at runtime with stale-while-revalidate: served instantly from cache
// and refreshed in the background when online, so instance data stays current
// without a build step. Bump CACHE to force a clean re-precache on next visit.
//
// CSP note: the page's `connect-src 'none'` restricts fetch/XHR from the page,
// not the service worker — the SW's own fetches run in the worker context
// (GitHub Pages sends no CSP header for sw.js), so caching works. Lazy region
// loading via <script> injection is intercepted here and served from cache.

const CACHE = "cir-cache-v1";

// Kept small and stable — anything missed here is still runtime-cached on first
// online visit. cache.add is per-file so one bad path can't abort the precache.
const PRECACHE = [
  "index.html",
  "aws.html",
  "azure.html",
  "gcp.html",
  "multicloud.html",
  "app-portfolio.html",
  "user-guide.html",
  "css/theme.css",
  "css/style.css",
  "css/index_style.css",
  "css/portfolio.css",
  "js/pwa-register.js",
  "manifest.json",
  "icon.svg",
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
