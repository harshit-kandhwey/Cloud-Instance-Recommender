// Results charts. Hand-built, no charting library — the CSP forbids loading one
// (`script-src 'self'`, `connect-src 'none'`), and nothing here needs one.
//
// Rendered into #resultsChartsSection by renderResultsCharts(), which every tool
// page carries. Like every shared renderer, it survives its element being absent:
// a page without the placeholder simply gets no charts rather than an exception.
//
// Colours are theme tokens, never literals, and every mark's step was chosen per
// theme against that theme's surface (see css/theme.css). Text wears the text
// tokens — a mark's colour never doubles as a label colour.

// ─── Match rate ───────────────────────────────────────────────────────────────
// A single ratio of a whole. Deliberately a METER and not a two-slice donut: a
// pie of two slices asks the eye to compare angles for something one length says
// exactly, and it is the textbook wrong form for this. The meter is a track of
// the same ramp as its fill, with the number stated in text beside it — the
// figure carries the verdict, the bar carries the proportion.
function _matchRateMeter(results) {
  const instanceCols = getInstanceColumns(results);
  if (!instanceCols.length) return "";

  const total = results.length;
  const unmatched = results.filter((row) =>
    rowIsAllNoMatch(row, instanceCols),
  ).length;
  const matched = total - unmatched;
  // Round toward the honest side: never show 100% while a row is unmatched, and
  // never show 0% while a row matched. A rounded 100 next to "3 no match" is the
  // kind of small lie that costs trust in every other number on the page.
  const raw = (matched / total) * 100;
  let pct = Math.round(raw);
  if (pct === 100 && unmatched > 0) pct = 99;
  if (pct === 0 && matched > 0) pct = 1;

  return `
    <figure style="margin:0 0 14px 0;">
      <figcaption style="font-size:12px;font-weight:600;color:var(--text-body);margin-bottom:6px;">Match rate</figcaption>
      <div style="display:flex;align-items:center;gap:10px;">
        <div role="img" aria-label="${matched} of ${total} rows matched an instance, ${pct} percent"
             style="flex:1;min-width:120px;height:10px;border-radius:5px;background:var(--success-bg);overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:var(--good-strong);border-radius:5px;"></div>
        </div>
        <span style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;">${pct}%</span>
      </div>
      <p style="margin:4px 0 0 0;font-size:11px;color:var(--text-soft);">
        <span style="color:var(--good-strong);">✓</span> ${matched} matched${
          unmatched > 0
            ? ` · <span style="color:var(--red-strong);">✗</span> ${unmatched} no match`
            : ""
        } · ${total} rows
      </p>
    </figure>`;
}

// ─── Entry point ──────────────────────────────────────────────────────────────
// Returns false when the page has no placeholder, so a caller can tell the
// difference between "nothing to draw" and "nowhere to draw it".
function renderResultsCharts(results) {
  const el = document.getElementById("resultsChartsSection");
  if (!el) return false;

  if (!results || !results.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return true;
  }

  const charts = [_matchRateMeter(results)].filter(Boolean).join("");
  if (!charts) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return true;
  }

  el.innerHTML = `
    <div style="padding:12px 16px;background:var(--surface);border:1px solid var(--border-slate-light);border-radius:8px;">
      ${charts}
    </div>`;
  el.classList.remove("hidden");
  return true;
}
window.renderResultsCharts = renderResultsCharts;
