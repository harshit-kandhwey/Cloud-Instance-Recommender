// PWA / offline verification:
//   - manifest.json shape (installability essentials)
//   - sw.js: install precaches the shell, activate purges old caches,
//     fetch does stale-while-revalidate (cache-first + background refresh,
//     runtime-caches new same-origin GETs, offline navigation falls back to
//     a cached shell), and non-GET / cross-origin requests are passed through
//   - every HTML page links the manifest and registers the worker
//   - the offline indicator banner appears on `offline`, flips to a
//     self-hiding "back online" notice, and shows immediately when the
//     page loads without a connection (deferring to DOMContentLoaded when
//     <body> doesn't exist yet)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..", "..");

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
    // The rest of the Cache surface sw.js may reach for. Missing them turned a
    // worker call into a TypeError the outer catch reported as a nameless crash,
    // pointing at the mock instead of the worker.
    async addAll(urls) {
      for (const u of urls) await this.add(u);
    },
    async keys() {
      return [...map.keys()];
    },
    async delete(req) {
      return map.delete(urlKey(req));
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

// Stalled-promise guard: fail by default, cleared only when the IIFE runs to
// completion. If an awaited value never settles the event loop drains and Node
// exits — without this, that silent stall would exit 0 with no output.
process.exitCode = 1;
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
  // Drain the waitUntil promises with allSettled (not Promise.all like the
  // online events above): offline, fetchMock rejects, so any network promise the
  // SW hands to waitUntil rejects too. Left unhandled, Node aborts the process on
  // the unhandled rejection and the checks below never report. Today the offline
  // paths call waitUntil zero times (e5.waits is empty), so there is nothing to
  // assert about a settlement — asserting an "expected rejection" on an empty
  // array would be vacuous; this drain is defensive future-proofing for a SW
  // change that starts backgrounding a fetch here. The offline BEHAVIOUR is
  // pinned by the r5/r6 response checks, not by these side-channel promises.
  await Promise.allSettled(e5.waits);
  check(
    "offline uncached navigation falls back to a cached shell",
    r5 && r5.url === "index.html",
    JSON.stringify(r5),
  );

  // offline + uncached non-navigation → error response (not a wrong page)
  const e6 = makeEvent(req("js/gcp/regions/never.js"));
  handlers.fetch(e6);
  const r6 = await e6.getResponse();
  await Promise.allSettled(e6.waits);
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

  // ── offline banner: run pwa-register.js in a fake page ────────────────────
  function makePage(onLine, opts) {
    opts = opts || {};
    const pendingTimers = [];
    const winListeners = {};
    const docListeners = {};
    const pageEls = {};
    const appendEl = (el) => {
      pageEls[el.id] = el;
    };
    const page = {
      console: sandbox.console,
      navigator: { onLine }, // no serviceWorker key → registration skipped
      setTimeout: (fn) => {
        pendingTimers.push(fn);
        return pendingTimers.length; // 1-based id = slot index + 1
      },
      // Model cancellation: null the slot so a cleared timer does NOT fire when
      // pendingTimers is later drained. A no-op here would let a cancelled
      // "hide banner" timer still run, masking a banner that vanishes offline.
      clearTimeout: (id) => {
        if (id) pendingTimers[id - 1] = null;
      },
      document: {
        addEventListener: (type, fn) => {
          docListeners[type] = fn;
        },
        getElementById: (id) => pageEls[id] || null,
        createElement: () => ({
          id: "",
          style: {},
          attrs: {},
          textContent: "",
          setAttribute(k, v) {
            this.attrs[k] = v;
          },
        }),
        // bodyLater simulates the script running before <body> exists
        // (e.g. in <head> without defer).
        body: opts.bodyLater ? null : { appendChild: appendEl },
      },
    };
    page.window = page;
    page.addEventListener = (type, fn) => {
      winListeners[type] = fn;
    };
    vm.createContext(page);
    vm.runInContext(reg, page, { filename: "js/pwa-register.js" });
    return {
      pageEls,
      winListeners,
      docListeners,
      pendingTimers,
      attachBody: () => {
        page.document.body = { appendChild: appendEl };
      },
    };
  }

  const onlinePage = makePage(true);
  check(
    "no banner while the page loads online",
    !onlinePage.pageEls.offlineBanner,
  );
  onlinePage.winListeners.offline();
  const ob = onlinePage.pageEls.offlineBanner;
  check(
    "offline event shows the banner as a polite status region",
    !!ob &&
      ob.style.display === "block" &&
      /Offline/.test(ob.textContent) &&
      ob.attrs.role === "status" &&
      ob.attrs["aria-live"] === "polite",
    ob &&
      JSON.stringify({ d: ob.style.display, t: ob.textContent, a: ob.attrs }),
  );
  onlinePage.winListeners.online();
  check(
    "online event flips the banner to a back-online notice",
    /Back online/.test(ob.textContent) && ob.style.display === "block",
    ob.textContent,
  );
  onlinePage.pendingTimers.forEach((fn) => fn && fn()); // skip cancelled timers
  check(
    "back-online notice hides itself after the timer",
    ob.style.display === "none",
  );

  const offlinePage = makePage(false);
  check(
    "loading the page without a connection shows the banner immediately",
    !!offlinePage.pageEls.offlineBanner &&
      offlinePage.pageEls.offlineBanner.style.display === "block" &&
      /Offline/.test(offlinePage.pageEls.offlineBanner.textContent),
  );

  // Offline at load but before <body> exists → no throw, banner deferred to
  // DOMContentLoaded instead.
  const lateBodyPage = makePage(false, { bodyLater: true });
  check(
    "offline load without a body defers the banner instead of throwing",
    !lateBodyPage.pageEls.offlineBanner &&
      typeof lateBodyPage.docListeners.DOMContentLoaded === "function",
  );
  lateBodyPage.attachBody();
  lateBodyPage.docListeners.DOMContentLoaded();
  check(
    "deferred banner appears once DOMContentLoaded fires",
    !!lateBodyPage.pageEls.offlineBanner &&
      lateBodyPage.pageEls.offlineBanner.style.display === "block" &&
      /Offline/.test(lateBodyPage.pageEls.offlineBanner.textContent),
  );

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log("pwa-test: all checks passed");
    process.exitCode = 0; // clears the up-front stalled-promise guard
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
