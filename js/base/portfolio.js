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
  window._portfolioPayload = payload; // handy for later commits / debugging
  renderPortfolio();
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

  const results = portfolioData.results;
  const apps = new Set(
    results.map((r) => String(r["App Name"] || "").trim()).filter(Boolean),
  );
  const unassigned = results.filter(
    (r) => !String(r["App Name"] || "").trim(),
  ).length;
  const providers = (portfolioData.providers || []).map((p) => p.toUpperCase());
  const generatedAt = portfolioData.generatedAt
    ? new Date(portfolioData.generatedAt).toLocaleString()
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
            <div class="counter-number">${apps.size}</div>
            <div class="counter-title">🧩 Applications</div>
          </div>
          <div class="counter-card">
            <div class="counter-number">${results.length}</div>
            <div class="counter-title">🖥️ VMs</div>
          </div>
          <div class="counter-card">
            <div class="counter-number">${unassigned}</div>
            <div class="counter-title">❓ Unassigned VMs</div>
          </div>
        </div>
        <p style="color: var(--text-body); margin-top: 12px; line-height: 1.7">
          Received from <strong>${esc(portfolioData.sourcePage || "a tool page")}</strong>${
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
