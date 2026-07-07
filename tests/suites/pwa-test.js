// PWA / offline verification:
//   - manifest.json shape (installability essentials)
//   - sw.js: install precaches the shell, activate purges old caches,
//     fetch does stale-while-revalidate (cache-first + background refresh,
//     runtime-caches new same-origin GETs, offline navigation falls back to
//     a cached shell), and non-GET / cross-origin requests are passed through
//   - every HTML page links the manifest and registers the worker
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
}

// ── manifest.json ───────────────────────────────────────────────────────────
const manifest = JSON.parse(
  fs.readFileSync(path.join(REPO, "manifest.json"), "utf8"),
);
check("manifest has a name", !!manifest.name);
check("manifest start_url is a page", manifest.start_url === "index.html");
check(
  "manifest is standalone (installable)",
  manifest.display === "standalone",
);
check(
  "manifest theme_color is a hex color",
  /^#[0-9a-f]{6}$/i.test(manifest.theme_color),
);
check(
  "manifest ships a maskable SVG icon that exists",
  (() => {
    const icon =
      Array.isArray(manifest.icons) &&
      manifest.icons.find(
        (i) => i.type === "image/svg+xml" && /maskable/.test(i.purpose || ""),
      );
    return !!icon && fs.existsSync(path.join(REPO, icon.src));
  })(),
);

// ── sw.js in a mocked ServiceWorkerGlobalScope ──────────────────────────────
const handlers = {};
const cachesStore = new Map(); // name -> Map(urlKey -> response)
// The Cache API keys by fully-resolved URL, so a relative precache entry
// ("aws.html") and an absolute fetch (https://…/aws.html) hit the same key.
const BASE = "https://x.test/";
const absKey = (u) => new URL(u, BASE).href;
const urlKey = (req) => absKey(typeof req === "string" ? req : req.url);

// What the "server" can serve (for precache adds + runtime fetches).
let online = true;
const serverFiles = new Set(
  [
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
    "js/aws/regions/us_east_1.js", // a lazily-loaded region file
  ].map(absKey),
);
const makeRes = (url, ok) => ({
  url,
  ok,
  type: "basic",
  clone() {
    return makeRes(url, ok);
  },
});
async function fetchMock(req) {
  const url = typeof req === "string" ? req : req.url;
  if (!online) throw new Error("offline");
  return makeRes(url, serverFiles.has(absKey(url)));
}
function cacheApi(map) {
  return {
    async match(req) {
      return map.get(urlKey(req));
    },
    async put(req, res) {
      map.set(urlKey(req), res);
    },
    async add(url) {
      const res = await fetchMock(url);
      if (res && res.ok) map.set(urlKey(url), res);
      else throw new Error("add failed: " + url);
    },
  };
}
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  URL,
  fetch: fetchMock,
  Response: { error: () => ({ ok: false, type: "error", _isError: true }) },
  location: { origin: "https://x.test" },
  clients: { claim: async () => {} },
  skipWaiting: () => {},
  addEventListener: (type, fn) => {
    handlers[type] = fn;
  },
  caches: {
    async open(name) {
      if (!cachesStore.has(name)) cachesStore.set(name, new Map());
      return cacheApi(cachesStore.get(name));
    },
    async keys() {
      return [...cachesStore.keys()];
    },
    async delete(name) {
      return cachesStore.delete(name);
    },
    async match(req) {
      for (const m of cachesStore.values()) {
        const r = m.get(urlKey(req));
        if (r) return r;
      }
      return undefined;
    },
  },
};
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(REPO, "sw.js"), "utf8"), sandbox, {
  filename: "sw.js",
});

function makeEvent(request) {
  const waits = [];
  let response;
  return {
    request,
    waitUntil: (p) => waits.push(p),
    respondWith: (p) => (response = p),
    waits,
    getResponse: () => response,
  };
}
const req = (url, extra) =>
  Object.assign(
    { url: "https://x.test/" + url, method: "GET", mode: "no-cors" },
    extra,
  );

(async () => {
  // install → precache
  const e1 = makeEvent();
  handlers.install(e1);
  await Promise.all(e1.waits);
  const v1 = cachesStore.get("cir-cache-v1");
  check(
    "install precaches the app shell",
    v1 &&
      v1.has(absKey("aws.html")) &&
      v1.has(absKey("css/style.css")) &&
      v1.has(absKey("icon.svg")),
    v1 ? [...v1.keys()].join(",") : "no cache",
  );

  // activate → purge stale caches
  cachesStore.set("cir-cache-old", new Map([["x", makeRes("x", true)]]));
  const e2 = makeEvent();
  handlers.activate(e2);
  await Promise.all(e2.waits);
  check(
    "activate deletes old caches, keeps current",
    cachesStore.has("cir-cache-v1") && !cachesStore.has("cir-cache-old"),
    [...cachesStore.keys()].join(","),
  );

  // fetch cached shell → served from cache + background refresh scheduled
  const e3 = makeEvent(req("aws.html", { mode: "navigate" }));
  handlers.fetch(e3);
  const r3 = await e3.getResponse();
  check(
    "cached request is served from cache",
    r3 && r3.url === "aws.html",
    JSON.stringify(r3),
  );
  check(
    "stale-while-revalidate schedules a background refresh",
    e3.waits.length === 1,
  );

  // fetch uncached same-origin GET (online) → network + runtime cache it
  const e4 = makeEvent(req("js/aws/regions/us_east_1.js"));
  handlers.fetch(e4);
  const r4 = await e4.getResponse();
  await Promise.all(e4.waits);
  check(
    "uncached request falls through to network",
    r4 && r4.ok && r4.url.endsWith("us_east_1.js"),
  );
  check(
    "runtime-caches the fetched region file",
    cachesStore
      .get("cir-cache-v1")
      .has("https://x.test/js/aws/regions/us_east_1.js"),
  );

  // offline + uncached navigation → cached shell fallback
  online = false;
  const e5 = makeEvent(req("never-visited.html", { mode: "navigate" }));
  handlers.fetch(e5);
  const r5 = await e5.getResponse();
  check(
    "offline uncached navigation falls back to a cached shell",
    r5 && r5.url === "index.html",
    JSON.stringify(r5),
  );

  // offline + uncached non-navigation → error response (not a wrong page)
  const e6 = makeEvent(req("js/gcp/regions/never.js"));
  handlers.fetch(e6);
  const r6 = await e6.getResponse();
  check(
    "offline uncached subresource returns an error response",
    r6 && r6._isError === true,
  );
  online = true;

  // non-GET is passed through (handler doesn't respond)
  const e7 = makeEvent(req("aws.html", { method: "POST" }));
  handlers.fetch(e7);
  check("non-GET requests are not intercepted", e7.getResponse() === undefined);

  // cross-origin is passed through
  const e8 = makeEvent({
    url: "https://other.test/x.js",
    method: "GET",
    mode: "no-cors",
  });
  handlers.fetch(e8);
  check(
    "cross-origin requests are not intercepted",
    e8.getResponse() === undefined,
  );

  // ── every page links the manifest + loads the shared registration script ──
  const pages = [
    "index.html",
    "aws.html",
    "azure.html",
    "gcp.html",
    "multicloud.html",
    "app-portfolio.html",
    "user-guide.html",
  ];
  const allWired = pages.every((p) => {
    const html = fs.readFileSync(path.join(REPO, p), "utf8");
    return (
      /rel="manifest"/.test(html) && /src="js\/pwa-register\.js"/.test(html)
    );
  });
  check("all 7 pages link the manifest and the registration script", allWired);

  // The shared script registers the SW, guarded on secure context.
  const reg = fs.readFileSync(path.join(REPO, "js/pwa-register.js"), "utf8");
  check(
    "pwa-register.js registers sw.js behind an isSecureContext guard",
    /serviceWorker\.register\("sw\.js"\)/.test(reg) &&
      /isSecureContext/.test(reg),
  );

  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("pwa-test: all checks passed");
})();
