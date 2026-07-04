// App Portfolio page controller.
//
// Receives a generated result set handed off from a tool page — postMessage is
// the primary channel (same-origin, no size cap, CSP-safe), with a localStorage
// copy as a cold-open / reload fallback — then renders an application-centric
// view and (in a later commit) an executive Excel export.
//
// This commit wires up the handoff and the page shell. The analytics engine,
// the tabbed UI, and the workbook export are added in subsequent commits.

// Shared with the tool-page handoff writer (downloads.js). Separate global
// scopes (this file only loads on app-portfolio.html), so no collision.
const PORTFOLIO_STORAGE_KEY = "cloudInstanceRecommenderPortfolioData";

// The most recently received handoff payload, or null until data arrives.
let portfolioData = null;

// The analytics model derived from portfolioData (see buildPortfolioModel).
let portfolioModel = null;

// ─── Handoff receiver ─────────────────────────────────────────────────────────
function initPortfolioHandoff() {
  window.addEventListener("message", onPortfolioMessage);

  // Announce readiness to the opener (the tool page). It replies with a
  // `portfolio-data` message carrying the full payload. Guarded: a cold open
  // via the nav link has no opener — the localStorage fallback covers that.
  try {
    if (window.opener) {
      window.opener.postMessage({ type: "portfolio-ready" }, location.origin);
    }
  } catch (e) {
    /* opener gone or cross-origin — fall through to localStorage */
  }

  // Immediate localStorage read (normal handoff writes a fresh copy just before
  // opening this page; also covers reloads and cold nav visits).
  loadPortfolioFromStorage();

  // Late fallback: for large estates the writer skips the localStorage copy and
  // relies on postMessage. If nothing has arrived shortly after load, try the
  // store once more before settling on the empty state.
  setTimeout(() => {
    if (!portfolioData) loadPortfolioFromStorage();
  }, 500);

  renderPortfolio();
}

function onPortfolioMessage(event) {
  if (event.origin !== location.origin) return;
  const msg = event.data || {};
  if (msg.type === "portfolio-data" && msg.payload) {
    receivePortfolio(msg.payload);
  }
}

function loadPortfolioFromStorage() {
  if (portfolioData) return;
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (raw) receivePortfolio(JSON.parse(raw));
  } catch (e) {
    console.warn("Portfolio localStorage read failed:", e);
  }
}

// Accepts a handoff payload, ignoring anything that isn't a non-empty result
// set. Idempotent: a postMessage delivery that duplicates the localStorage copy
// simply re-renders the same data.
function receivePortfolio(payload) {
  if (!payload || !Array.isArray(payload.results) || !payload.results.length) {
    return;
  }
  portfolioData = payload;
  portfolioModel = buildPortfolioModel(payload);
  window._portfolioPayload = payload; // handy for later commits / debugging
  window._portfolioModel = portfolioModel;
  renderPortfolio();
}

// ─── Analytics engine (pure) ──────────────────────────────────────────────────
// buildPortfolioModel(payload) turns a handoff payload into an
// application-centric model that the UI and the Excel export both consume.
// Everything here is side-effect-free and unit-tested (portfolio-test.js).
//
// The portfolio page does not load preview.js / downloads.js (they carry
// tool-page DOM and a colliding PORTFOLIO_STORAGE_KEY), so it keeps its own
// copies of these two tiny predicates. Semantics must stay in step with
// preview.js#isNoMatchValue and downloads.js#getInstanceColumns.
const PORTFOLIO_NO_MATCH = new Set([
  "No data available",
  "Missing data",
  "Error",
  "No utilization data",
]);
function isNoMatchValue(v) {
  return !v || PORTFOLIO_NO_MATCH.has(String(v)) || String(v).startsWith("No ");
}
function getInstanceColumns(results) {
  if (!results || !results.length) return [];
  return Object.keys(results[0]).filter(
    (k) =>
      k.includes("Like-to-Like Instance") || k.includes("Optimized Instance"),
  );
}

// Result columns prefix each provider's recommendations in upper case.
const PORTFOLIO_PROVIDER_LABELS = { aws: "AWS", azure: "AZURE", gcp: "GCP" };

function appNameOf(row) {
  return String(row["App Name"] || "").trim();
}

function toNum(v, asInt) {
  const n = asInt ? parseInt(v, 10) : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function tally(map, key) {
  map[key] = (map[key] || 0) + 1;
}

// Recommended-instance family prefix, per provider naming:
//   AWS   m6g.xlarge    → m6g   (before the ".")
//   AZURE d4psv6        → D     (leading letters, upper-cased)
//   GCP   e2-standard-4 → e2    (before the first "-")
function extractFamily(provider, instanceType) {
  if (!instanceType || isNoMatchValue(instanceType)) return null;
  const s = String(instanceType).trim();
  if (!s) return null;
  if (provider === "aws") return s.split(".")[0] || null;
  if (provider === "gcp") return s.split("-")[0] || null;
  if (provider === "azure") {
    const m = s.replace(/^standard[_-]/i, "").match(/^[a-zA-Z]+/);
    return m ? m[0].toUpperCase() : null;
  }
  return s;
}

function normEnv(v) {
  const s = String(v || "").trim();
  if (!s) return "Unspecified";
  const l = s.toLowerCase();
  if (l.startsWith("prod")) return "Production";
  if (l.startsWith("stag")) return "Staging";
  if (l.startsWith("dev")) return "Dev";
  if (l.startsWith("test")) return "Test";
  return s;
}
function normOS(v) {
  const s = String(v || "").trim();
  if (!s) return "Unspecified";
  const l = s.toLowerCase();
  if (l.includes("windows")) return "Windows";
  if (l.includes("linux")) return "Linux";
  if (l.includes("mac")) return "macOS";
  return s;
}
function normWorkload(v) {
  return String(v || "").trim() || "Unspecified";
}
// Compliance cells may carry multiple tags ("PCI, HIPAA"); returns them upper-cased.
function complianceTags(v) {
  return String(v || "")
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
}

// Aggregates one app's VMs (app === "" is the Unassigned data-hygiene bucket).
function computeAppStats(app, rows, meta) {
  const stats = {
    app,
    vms: rows.length,
    vcpus: 0,
    memory: 0,
    avgVcpus: 0,
    avgMemory: 0,
    envMix: {},
    osMix: {},
    workloadMix: {},
    compliance: {},
    hasCompliance: false,
    regions: [],
    multiRegion: false,
    families: {},
    matched: 0,
    noMatch: 0,
    matchRate: 0,
    noMatchReasons: [],
    rightSizing: null,
    rows,
  };

  const regionSet = new Set();
  const reasonCounts = {};
  const familyAcc = {};
  const rsAcc = {};
  meta.providers.forEach((p) => {
    familyAcc[p] = {};
    if (meta.hasOptimized) rsAcc[p] = { downsize: 0, upsize: 0, same: 0 };
  });

  rows.forEach((row) => {
    stats.vcpus += toNum(row["CPU Count"], true);
    stats.memory += toNum(row["Memory (GB)"], false);
    tally(stats.envMix, normEnv(row["ENV"]));
    tally(stats.osMix, normOS(row["OS"]));
    tally(stats.workloadMix, normWorkload(row["Workload"]));
    complianceTags(row["Compliance"]).forEach((t) => {
      tally(stats.compliance, t);
      stats.hasCompliance = true;
    });
    meta.regionCols.forEach((rc) => {
      const rv = String(row[rc] || "").trim();
      if (rv) regionSet.add(rv);
    });

    const hasMatch = meta.instCols.some((c) => !isNoMatchValue(row[c]));
    if (hasMatch) stats.matched++;
    else stats.noMatch++;

    meta.reasonCols.forEach((rc) => {
      const reason = String(row[rc] || "").trim();
      if (reason) tally(reasonCounts, reason);
    });

    meta.providers.forEach((p) => {
      const col = meta.familyCol[p];
      if (col) {
        const fam = extractFamily(p, row[col]);
        if (fam) tally(familyAcc[p], fam);
      }
      if (meta.hasOptimized && rsAcc[p]) {
        const optInst = meta.optInstCol[p] ? row[meta.optInstCol[p]] : "";
        if (optInst && !isNoMatchValue(optInst)) {
          // vCPU-based (the optimization strategy is vCPU-driven: N/2, N, N+1)
          const optV = toNum(row[meta.optVcpuCol[p]], true);
          const inV = toNum(row["CPU Count"], true);
          if (optV && inV) {
            if (optV < inV) rsAcc[p].downsize++;
            else if (optV > inV) rsAcc[p].upsize++;
            else rsAcc[p].same++;
          }
        }
      }
    });
  });

  stats.families = familyAcc;
  stats.regions = [...regionSet].sort();
  stats.multiRegion = regionSet.size > 1;
  stats.memory = Math.round(stats.memory * 100) / 100;
  stats.matchRate = stats.vms
    ? Math.round((stats.matched / stats.vms) * 100)
    : 0;
  stats.avgVcpus = stats.vms
    ? Math.round((stats.vcpus / stats.vms) * 100) / 100
    : 0;
  stats.avgMemory = stats.vms
    ? Math.round((stats.memory / stats.vms) * 100) / 100
    : 0;
  stats.noMatchReasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
  if (meta.hasOptimized) stats.rightSizing = rsAcc;

  return stats;
}

// Turns a handoff payload into the full application-centric model.
function buildPortfolioModel(payload) {
  const results = (payload && payload.results) || [];
  const providers = (payload && payload.providers) || [];
  const keys = results.length ? Object.keys(results[0]) : [];

  const hasOptimized = keys.some((k) => k.includes("Optimized Instance"));
  const hasLikeToLike = keys.some((k) => k.includes("Like-to-Like Instance"));
  const regionCols = ["AWS Region", "Azure Region", "GCP Region"].filter((c) =>
    keys.includes(c),
  );
  const reasonCols = keys.filter((k) => k.includes("No Match Reason"));

  // Representative recommendation column per provider (Optimized preferred),
  // plus the Optimized instance/vCPU columns used for right-sizing.
  const familyCol = {};
  const optInstCol = {};
  const optVcpuCol = {};
  providers.forEach((p) => {
    const P = PORTFOLIO_PROVIDER_LABELS[p] || String(p).toUpperCase();
    const opt = `${P} Optimized Instance`;
    const l2l = `${P} Like-to-Like Instance`;
    familyCol[p] = keys.includes(opt) ? opt : keys.includes(l2l) ? l2l : null;
    optInstCol[p] = keys.includes(opt) ? opt : null;
    const optV = `${P} Optimized vCPUs`;
    optVcpuCol[p] = keys.includes(optV) ? optV : null;
  });

  const meta = {
    instCols: getInstanceColumns(results),
    providers,
    hasOptimized,
    hasLikeToLike,
    regionCols,
    reasonCols,
    familyCol,
    optInstCol,
    optVcpuCol,
  };

  // Group VMs by app; blank App Name → the Unassigned bucket.
  const byApp = new Map();
  const unassignedRows = [];
  results.forEach((row) => {
    const app = appNameOf(row);
    if (!app) return void unassignedRows.push(row);
    if (!byApp.has(app)) byApp.set(app, []);
    byApp.get(app).push(row);
  });

  const apps = [...byApp.entries()]
    .map(([app, rows]) => computeAppStats(app, rows, meta))
    .sort((a, b) => a.app.localeCompare(b.app));
  const unassigned = unassignedRows.length
    ? computeAppStats("", unassignedRows, meta)
    : null;

  // Estate totals (named apps + Unassigned).
  const allStats = unassigned ? [...apps, unassigned] : apps;
  const estate = {
    apps: apps.length,
    vms: results.length,
    vcpus: allStats.reduce((s, a) => s + a.vcpus, 0),
    memory:
      Math.round(allStats.reduce((s, a) => s + a.memory, 0) * 100) / 100,
    matched: allStats.reduce((s, a) => s + a.matched, 0),
    noMatch: 0,
    matchRate: 0,
  };
  estate.noMatch = estate.vms - estate.matched;
  estate.matchRate = estate.vms
    ? Math.round((estate.matched / estate.vms) * 100)
    : 0;

  // Rankings / callouts (named apps only).
  const bySize = [...apps].sort(
    (a, b) => b.vcpus - a.vcpus || b.memory - a.memory,
  );
  const worstMatchRate = [...apps]
    .filter((a) => a.noMatch > 0)
    .sort((a, b) => a.matchRate - b.matchRate || b.noMatch - a.noMatch);
  const complianceSensitive = apps.filter((a) => a.hasCompliance);

  // Workload totals across the estate.
  const workloadTotals = {};
  allStats.forEach((a) =>
    Object.entries(a.workloadMix).forEach(([k, n]) => {
      workloadTotals[k] = (workloadTotals[k] || 0) + n;
    }),
  );

  return {
    meta: {
      sourcePage: (payload && payload.sourcePage) || "",
      providers,
      generatedAt: (payload && payload.generatedAt) || "",
      dataDates: (payload && payload.dataDates) || {},
      hasOptimized,
      hasLikeToLike,
      columnHeaders: (payload && payload.columnHeaders) || [],
    },
    estate,
    apps,
    unassigned,
    rankings: { bySize, worstMatchRate, complianceSensitive },
    workloadTotals,
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────
// Commit 1 shows the empty state until data arrives, then a minimal confirmation
// that the handoff worked. The interactive tabbed dashboard replaces the
// confirmation in a later commit.
function renderPortfolio() {
  const empty = document.getElementById("portfolioEmpty");
  const content = document.getElementById("portfolioContent");
  if (!content) return;

  if (!portfolioData) {
    if (empty) empty.classList.remove("hidden");
    content.classList.add("hidden");
    return;
  }

  if (empty) empty.classList.add("hidden");
  content.classList.remove("hidden");

  const est = portfolioModel.estate;
  const unassigned = portfolioModel.unassigned
    ? portfolioModel.unassigned.vms
    : 0;
  const providers = (portfolioModel.meta.providers || []).map((p) =>
    p.toUpperCase(),
  );
  const generatedAt = portfolioModel.meta.generatedAt
    ? new Date(portfolioModel.meta.generatedAt).toLocaleString()
    : "";

  const esc = typeof escapeHtml === "function" ? escapeHtml : (s) => s;

  content.innerHTML = `
    <section class="section">
      <div class="section-header">
        <span class="section-icon">📊</span>
        <h2 class="section-title">Portfolio loaded</h2>
      </div>
      <div class="section-content">
        <div class="stats-grid">
          <div class="counter-card">
            <div class="counter-number">${est.apps}</div>
            <div class="counter-title">🧩 Applications</div>
          </div>
          <div class="counter-card">
            <div class="counter-number">${est.vms}</div>
            <div class="counter-title">🖥️ VMs</div>
          </div>
          <div class="counter-card">
            <div class="counter-number">${est.matchRate}%</div>
            <div class="counter-title">✅ Match rate</div>
          </div>
          <div class="counter-card">
            <div class="counter-number">${unassigned}</div>
            <div class="counter-title">❓ Unassigned VMs</div>
          </div>
        </div>
        <p style="color: var(--text-body); margin-top: 12px; line-height: 1.7">
          Received from <strong>${esc(portfolioModel.meta.sourcePage || "a tool page")}</strong>${
            providers.length
              ? ` · providers <strong>${esc(providers.join(", "))}</strong>`
              : ""
          }${generatedAt ? ` · generated ${esc(generatedAt)}` : ""}.
        </p>
        <p style="color: var(--text-muted); font-size: 0.9em">
          The interactive per-app dashboards and the executive Excel export are
          coming next.
        </p>
      </div>
    </section>
  `;
}

// defer guarantees the DOM is parsed, but guard in case the load method changes.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPortfolioHandoff);
} else {
  initPortfolioHandoff();
}
