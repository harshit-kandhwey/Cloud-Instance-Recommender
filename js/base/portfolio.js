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
      instCols: meta.instCols,
    },
    estate,
    apps,
    unassigned,
    rankings: { bySize, worstMatchRate, complianceSensitive },
    workloadTotals,
  };
}

// ─── Render (tabbed dashboard) ────────────────────────────────────────────────
// Overview tab (KPIs + sortable/searchable app table + callouts) plus one tab
// per app (and an Unassigned tab). Pure CSS/DOM, theme-aware via portfolio.css.
// Interactions use inline onclick/oninput handlers (CSP allows 'unsafe-inline').

const esc = (v) => (typeof escapeHtml === "function" ? escapeHtml(String(v)) : String(v));

// Overview table sort/filter/expand state (persists across re-renders).
const overviewState = {
  sort: "vcpus",
  dir: "desc",
  filter: "",
  expanded: new Set(),
};

// Fixed hues for well-known categories; other keys cycle a palette. These stay
// literal (like the provider brand colors) and are saturated enough for both themes.
const PF_ENV_COLORS = {
  Production: "#dc2626",
  Staging: "#d97706",
  Dev: "#2563eb",
  Test: "#7c3aed",
  Unspecified: "#94a3b8",
};
const PF_OS_COLORS = {
  Linux: "#f59e0b",
  Windows: "#2563eb",
  macOS: "#64748b",
  Unspecified: "#94a3b8",
};
const PF_PALETTE = [
  "#667eea", "#4ecdc4", "#f59e0b", "#dc2626", "#7c3aed",
  "#0ea5e9", "#15803d", "#db2777", "#64748b", "#b45309",
];
const _pfKeyColors = {};
function pfKeyColor(key) {
  if (!(key in _pfKeyColors)) {
    _pfKeyColors[key] = PF_PALETTE[Object.keys(_pfKeyColors).length % PF_PALETTE.length];
  }
  return _pfKeyColors[key];
}
const pfEnvColor = (k) => PF_ENV_COLORS[k] || pfKeyColor(k);
const pfOsColor = (k) => PF_OS_COLORS[k] || pfKeyColor(k);

function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function kpiTile(icon, value, label) {
  return `<div class="counter-card"><div class="counter-number">${esc(value)}</div><div class="counter-title">${icon} ${esc(label)}</div></div>`;
}

// A proportional stacked bar + legend from a {key: count} map.
function pfBar(counts, colorFn) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) return '<span class="pf-muted">—</span>';
  const segs = entries
    .map(
      ([k, n]) =>
        `<span class="pf-bar-seg" style="width:${((n / total) * 100).toFixed(2)}%;background:${colorFn(k)}" title="${esc(k)}: ${n}"></span>`,
    )
    .join("");
  const legend = entries
    .map(
      ([k, n]) =>
        `<span class="pf-legend-item"><span class="pf-swatch" style="background:${colorFn(k)}"></span>${esc(k)} <b>${n}</b></span>`,
    )
    .join("");
  return `<div class="pf-bar">${segs}</div><div class="pf-legend">${legend}</div>`;
}

function pfChips(items, cls) {
  return items.map((t) => `<span class="pf-chip ${cls || ""}">${esc(t)}</span>`).join(" ");
}

function matchBadge(rate) {
  const cls = rate >= 90 ? "pf-chip-ok" : rate >= 50 ? "pf-chip-warn" : "pf-chip-danger";
  return `<span class="pf-chip ${cls}">${rate}%</span>`;
}

function vmMatchCell(row) {
  const matched = portfolioModel.meta.instCols.some((c) => !isNoMatchValue(row[c]));
  return matched
    ? '<span class="pf-chip pf-chip-ok">✓ matched</span>'
    : '<span class="pf-chip pf-chip-danger">✗ no match</span>';
}

function renderPortfolio() {
  const empty = document.getElementById("portfolioEmpty");
  const content = document.getElementById("portfolioContent");
  if (!content) return;

  if (!portfolioModel) {
    if (empty) empty.classList.remove("hidden");
    content.classList.add("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");
  content.classList.remove("hidden");

  const m = portfolioModel;
  const providers = (m.meta.providers || []).map((p) => p.toUpperCase());
  const generatedAt = m.meta.generatedAt
    ? new Date(m.meta.generatedAt).toLocaleString()
    : "";

  const tabs = [
    `<button class="pf-tab active" data-tab="overview" onclick="switchPortfolioTab('overview')">📊 Overview</button>`,
    ...m.apps.map(
      (a, i) =>
        `<button class="pf-tab" data-tab="app-${i}" onclick="switchPortfolioTab('app-${i}')">${esc(a.app)}</button>`,
    ),
  ];
  if (m.unassigned) {
    tabs.push(
      `<button class="pf-tab" data-tab="unassigned" onclick="switchPortfolioTab('unassigned')">❓ Unassigned</button>`,
    );
  }

  const panels = [
    `<div class="pf-panel active" id="pf-panel-overview">${renderOverview(m)}</div>`,
    ...m.apps.map(
      (a, i) => `<div class="pf-panel" id="pf-panel-app-${i}">${renderAppPanel(a, m, i)}</div>`,
    ),
  ];
  if (m.unassigned) {
    panels.push(
      `<div class="pf-panel" id="pf-panel-unassigned">${renderAppPanel(m.unassigned, m, "unassigned")}</div>`,
    );
  }

  content.innerHTML = `
    <div class="pf-toolbar">
      <div class="pf-meta">
        Generated from <strong>${esc(m.meta.sourcePage || "a tool page")}</strong>${
          providers.length ? ` · <strong>${esc(providers.join(", "))}</strong>` : ""
        }${generatedAt ? ` · ${esc(generatedAt)}` : ""}
      </div>
      <div id="pfExportSlot"></div>
    </div>
    <div class="pf-tabs" role="tablist">${tabs.join("")}</div>
    ${panels.join("")}
  `;

  renderAppTableBody();
  updateSortIndicators();
}

function switchPortfolioTab(tab) {
  document.querySelectorAll(".pf-tab").forEach((t) => {
    t.classList.toggle("active", t.getAttribute("data-tab") === tab);
  });
  document.querySelectorAll(".pf-panel").forEach((p) => {
    p.classList.toggle("active", p.id === `pf-panel-${tab}`);
  });
}

// ── Overview ──────────────────────────────────────────────────────────────────
function sortableTh(label, key) {
  return `<th class="pf-th-sort" data-sort="${key}" onclick="sortPortfolioApps('${key}')" title="Sort by ${esc(label)}"><span>${esc(label)}</span><span class="pf-sort-ind" data-ind="${key}"></span></th>`;
}

function renderOverview(m) {
  const est = m.estate;
  const kpis = `<div class="pf-kpis">
    ${kpiTile("🧩", est.apps, "Applications")}
    ${kpiTile("🖥️", est.vms, "VMs")}
    ${kpiTile("⚙️", est.vcpus, "vCPUs")}
    ${kpiTile("💾", fmtNum(est.memory), "Memory (GB)")}
    ${kpiTile("✅", est.matchRate + "%", "Match rate")}
  </div>`;

  const table = `<div class="pf-section">
    <div class="pf-section-head">
      <h3>Applications</h3>
      <input class="pf-search form-control" type="search" placeholder="Filter applications…"
        value="${esc(overviewState.filter)}" oninput="filterPortfolioApps(this.value)"
        aria-label="Filter applications" />
    </div>
    <div class="pf-scroll">
      <table class="pf-table" id="pf-app-table">
        <thead><tr>
          ${sortableTh("App", "app")}
          ${sortableTh("VMs", "vms")}
          ${sortableTh("vCPUs", "vcpus")}
          ${sortableTh("Memory (GB)", "memory")}
          <th>ENV mix</th>
          ${sortableTh("Match %", "matchRate")}
          <th>Regions</th>
          <th>Compliance</th>
        </tr></thead>
        <tbody id="pf-app-tbody"></tbody>
      </table>
    </div>
    <div class="pf-count" id="pf-app-count"></div>
  </div>`;

  return kpis + table + renderCallouts(m);
}

function sortApps(apps) {
  const { sort, dir } = overviewState;
  const mul = dir === "asc" ? 1 : -1;
  return [...apps].sort((a, b) => {
    if (sort === "app") return mul * String(a.app).localeCompare(String(b.app));
    return mul * ((a[sort] || 0) - (b[sort] || 0));
  });
}

function renderAppTableBody() {
  const tbody = document.getElementById("pf-app-tbody");
  if (!tbody || !portfolioModel) return;
  const q = overviewState.filter.trim().toLowerCase();
  const filtered = portfolioModel.apps.filter(
    (a) => !q || a.app.toLowerCase().includes(q),
  );
  const apps = sortApps(filtered);

  tbody.innerHTML =
    apps
      .map((a) => {
        const i = portfolioModel.apps.indexOf(a);
        const open = overviewState.expanded.has(i);
        const regionCell = a.regions.length
          ? a.multiRegion
            ? `${a.regions.length} ✳`
            : String(a.regions.length)
          : "—";
        const compCell = a.hasCompliance
          ? pfChips(Object.keys(a.compliance), "pf-chip-danger")
          : "—";
        const main = `<tr class="pf-app-row" onclick="togglePortfolioAppRow(${i})">
          <td><span class="pf-caret">${open ? "▾" : "▸"}</span> ${esc(a.app)}</td>
          <td>${a.vms}</td>
          <td>${a.vcpus}</td>
          <td>${fmtNum(a.memory)}</td>
          <td>${pfBar(a.envMix, pfEnvColor)}</td>
          <td>${matchBadge(a.matchRate)}</td>
          <td title="${esc(a.regions.join(", "))}">${regionCell}</td>
          <td>${compCell}</td>
        </tr>`;
        const detail = open
          ? `<tr class="pf-detail-row"><td colspan="8">${renderAppExpand(a, i)}</td></tr>`
          : "";
        return main + detail;
      })
      .join("") ||
    `<tr><td colspan="8" class="pf-muted">${
      overviewState.filter
        ? `No applications match “${esc(overviewState.filter)}”.`
        : "No applications."
    }</td></tr>`;

  const count = document.getElementById("pf-app-count");
  if (count) {
    count.textContent = `Showing ${apps.length} of ${portfolioModel.apps.length} application(s)`;
  }
}

function renderAppExpand(a, i) {
  const rows = a.rows
    .slice(0, 50)
    .map(
      (r) => `<tr>
        <td>${esc(r["VM Name"] || "—")}</td>
        <td>${esc(r["CPU Count"] || "")}</td>
        <td>${esc(r["Memory (GB)"] || "")}</td>
        <td>${esc(r["ENV"] || "—")}</td>
        <td>${vmMatchCell(r)}</td>
      </tr>`,
    )
    .join("");
  const more =
    a.rows.length > 50
      ? `<div class="pf-muted">+${a.rows.length - 50} more — open the ${esc(a.app)} tab for the full list.</div>`
      : "";
  return `<div class="pf-expand">
    <button class="btn btn-secondary pf-mini-btn" onclick="event.stopPropagation(); switchPortfolioTab('app-${i}')">Open ${esc(a.app)} tab →</button>
    <div class="pf-scroll"><table class="pf-table pf-table-sm">
      <thead><tr><th>VM</th><th>CPU</th><th>Mem (GB)</th><th>ENV</th><th>Match</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${more}
  </div>`;
}

function renderCallouts(m) {
  const list = (arr, fmt) =>
    arr.length ? `<ul class="pf-list">${arr.map(fmt).join("")}</ul>` : '<div class="pf-muted">None</div>';
  return `<div class="pf-callouts">
    <div class="pf-card">
      <h4>🏔️ Biggest applications</h4>
      ${list(m.rankings.bySize.slice(0, 5), (a) => `<li>${esc(a.app)} — <b>${a.vcpus}</b> vCPUs · ${fmtNum(a.memory)} GB</li>`)}
    </div>
    <div class="pf-card">
      <h4>⚠️ Worst match rate</h4>
      ${list(m.rankings.worstMatchRate.slice(0, 5), (a) => `<li>${esc(a.app)} — <b>${a.matchRate}%</b> (${a.noMatch} no-match)</li>`)}
    </div>
    <div class="pf-card">
      <h4>🔒 Compliance-sensitive</h4>
      ${list(m.rankings.complianceSensitive, (a) => `<li>${esc(a.app)} — ${pfChips(Object.keys(a.compliance), "pf-chip-danger")}</li>`)}
    </div>
    <div class="pf-card">
      <h4>❓ Unassigned VMs</h4>
      ${
        m.unassigned
          ? `<div><b>${m.unassigned.vms}</b> VM(s) with no App Name — <a href="#" onclick="switchPortfolioTab('unassigned');return false;">review</a>.</div>`
          : '<div class="pf-muted">None — every VM has an App Name 🎉</div>'
      }
    </div>
  </div>`;
}

// Interaction handlers (called from inline attributes).
function filterPortfolioApps(v) {
  overviewState.filter = v || "";
  renderAppTableBody();
}
function sortPortfolioApps(key) {
  if (overviewState.sort === key) {
    overviewState.dir = overviewState.dir === "asc" ? "desc" : "asc";
  } else {
    overviewState.sort = key;
    overviewState.dir = key === "app" ? "asc" : "desc";
  }
  renderAppTableBody();
  updateSortIndicators();
}
function togglePortfolioAppRow(i) {
  if (overviewState.expanded.has(i)) overviewState.expanded.delete(i);
  else overviewState.expanded.add(i);
  renderAppTableBody();
}
function updateSortIndicators() {
  document.querySelectorAll(".pf-sort-ind").forEach((s) => {
    const key = s.getAttribute("data-ind");
    s.textContent =
      key === overviewState.sort ? (overviewState.dir === "asc" ? " ▲" : " ▼") : "";
  });
}

// ── Per-app panel ─────────────────────────────────────────────────────────────
function renderAppPanel(a, m, idx) {
  const title = a.app || "Unassigned (no App Name)";
  const kpis = `<div class="pf-kpis">
    ${kpiTile("🖥️", a.vms, "VMs")}
    ${kpiTile("⚙️", a.vcpus, `vCPUs (avg ${fmtNum(a.avgVcpus)})`)}
    ${kpiTile("💾", fmtNum(a.memory), `Memory GB (avg ${fmtNum(a.avgMemory)})`)}
    ${kpiTile("✅", a.matchRate + "%", `Matched ${a.matched}/${a.vms}`)}
  </div>`;

  const mixes = `<div class="pf-mixes">
    <div class="pf-mix"><h4>ENV</h4>${pfBar(a.envMix, pfEnvColor)}</div>
    <div class="pf-mix"><h4>OS</h4>${pfBar(a.osMix, pfOsColor)}</div>
    <div class="pf-mix"><h4>Workload</h4>${pfBar(a.workloadMix, pfKeyColor)}
      <small class="pf-note">Reflects the Workload column in the results; app-inherited workloads aren't shown.</small>
    </div>
  </div>`;

  const compliance = a.hasCompliance
    ? `<div class="pf-block"><h4>🔒 Compliance</h4>${pfChips(Object.entries(a.compliance).map(([k, n]) => `${k} ×${n}`), "pf-chip-danger")}</div>`
    : "";
  const regions = `<div class="pf-block"><h4>🌍 Regions ${
    a.multiRegion ? '<span class="pf-chip pf-chip-warn">multi-region</span>' : ""
  }</h4>${a.regions.length ? pfChips(a.regions, "pf-chip-info") : '<span class="pf-muted">—</span>'}</div>`;

  const blocks =
    compliance +
    regions +
    renderFamilies(a, m) +
    renderHealth(a) +
    renderRightSizing(a, m);

  return `<h3 style="margin:0 0 12px;color:var(--heading-indigo)">${esc(title)}</h3>
    ${kpis}${mixes}<div class="pf-blocks">${blocks}</div>${renderVmTable(a, m)}`;
}

function renderFamilies(a, m) {
  const provs = m.meta.providers.filter(
    (p) => a.families[p] && Object.keys(a.families[p]).length,
  );
  if (!provs.length) return "";
  const blocks = provs
    .map((p) => {
      const chips = pfChips(
        Object.entries(a.families[p])
          .sort((x, y) => y[1] - x[1])
          .map(([f, n]) => `${f} ×${n}`),
      );
      return `<div class="pf-fam"><span class="pf-fam-prov">${PORTFOLIO_PROVIDER_LABELS[p] || p.toUpperCase()}</span> ${chips}</div>`;
    })
    .join("");
  return `<div class="pf-block"><h4>🧬 Recommended families</h4>${blocks}</div>`;
}

function renderHealth(a) {
  const reasons = a.noMatchReasons.slice(0, 5);
  const rlist = reasons.length
    ? `<ul class="pf-list">${reasons.map((r) => `<li>${esc(r.reason)} <b>×${r.count}</b></li>`).join("")}</ul>`
    : '<div class="pf-muted">All VMs matched 🎉</div>';
  return `<div class="pf-block"><h4>🩺 Match health — ${a.matched}/${a.vms} (${a.matchRate}%)</h4>${rlist}</div>`;
}

function renderRightSizing(a, m) {
  if (!a.rightSizing) return "";
  const provs = m.meta.providers.filter((p) => a.rightSizing[p]);
  if (!provs.length) return "";
  const blocks = provs
    .map((p) => {
      const rs = a.rightSizing[p];
      return `<div class="pf-fam"><span class="pf-fam-prov">${PORTFOLIO_PROVIDER_LABELS[p] || p.toUpperCase()}</span> <span class="pf-chip pf-chip-ok">▼ ${rs.downsize}</span> <span class="pf-chip">= ${rs.same}</span> <span class="pf-chip pf-chip-warn">▲ ${rs.upsize}</span></div>`;
    })
    .join("");
  return `<div class="pf-block"><h4>📐 Right-sizing (Optimized, by vCPU)</h4>${blocks}<small class="pf-note">▼ downsize · = same · ▲ upsize vs. current vCPUs</small></div>`;
}

// All result columns (input order first, then the provider outputs), scrollable.
function vmDetailColumns(m) {
  const sample = (portfolioData.results && portfolioData.results[0]) || {};
  const keys = Object.keys(sample);
  const headers = (m.meta.columnHeaders || []).filter((h) => keys.includes(h));
  const rest = keys.filter((k) => !headers.includes(k));
  return [...headers, ...rest];
}

function renderVmTable(a, m) {
  const cols = vmDetailColumns(m);
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = a.rows
    .map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] ?? "")}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="pf-block"><h4>📋 VM detail (${a.vms})</h4><div class="pf-scroll"><table class="pf-table pf-table-sm"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}

// defer guarantees the DOM is parsed, but guard in case the load method changes.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPortfolioHandoff);
} else {
  initPortfolioHandoff();
}
