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

// ─── Family distribution ────────────────────────────────────────────────────
// What KINDS of instance the recommendations landed on — the count per family
// category ("General purpose", "Compute optimized", …), which is the family
// field the provider itself assigns, carried on the row since 3.8.5 and read
// straight from it (Azure's family is not derivable from the instance name).
//
// A magnitude-by-category comparison, so a horizontal bar per category, one
// hue — the category's identity is its axis label, never its colour, so there
// is no legend to key and no palette to cycle. Per provider, because the
// category LABELS genuinely differ between clouds (AWS "GPU instance" vs Azure
// "GPU" vs GCP "Accelerator optimized") and must not be silently merged. The
// category count is small by construction (~6–9), which is the whole reason
// 3.8.5 stored the category and not the exact family (188 of those on AWS) —
// so nothing is folded into an "Other".
function _familyDistribution(results) {
  // Providers that carry a family column, in first-seen order.
  const keys = Object.keys(results[0]);
  const providers = [];
  for (const k of keys) {
    const m = k.match(/^(.*) (?:Optimized|Like-to-Like) Family$/);
    if (m && !providers.includes(m[1])) providers.push(m[1]);
  }
  if (!providers.length) return "";

  const blocks = providers
    .map((provider) => {
      // Prefer the optimized recommendation when the run produced one — that is
      // the instance you would actually deploy; otherwise the like-for-like.
      const kind = keys.includes(`${provider} Optimized Family`)
        ? "Optimized"
        : "Like-to-Like";
      const instanceCol = `${provider} ${kind} Instance`;
      const familyCol = `${provider} ${kind} Family`;

      // Count families only over rows that matched — a no-match row has no
      // family to attribute, and counting its "N/A"/"Error" placeholder would
      // invent a category. One guard, the shared no-match predicate on the
      // instance column: a matched instance always carries a real family from
      // the region data, so the family cells that reach the tally are all real.
      // (The `!family` check is only a belt-and-braces against an empty family
      // name in the data — not a second no-match test.)
      const counts = new Map();
      let matched = 0;
      for (const row of results) {
        if (isNoMatchValue(row[instanceCol])) continue;
        const family = row[familyCol];
        if (!family) continue;
        counts.set(family, (counts.get(family) || 0) + 1);
        matched++;
      }
      if (!matched) return "";

      const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const max = ordered[0][1];
      const rows = ordered
        .map(([family, n]) => {
          const pct = Math.round((n / max) * 100);
          const label = escapeHtml(family);
          return `
        <div role="listitem" style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:12px;">
          <span style="flex:0 0 120px;color:var(--text-body);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${label}">${label}</span>
          <span style="flex:1;min-width:60px;height:14px;background:var(--success-bg);border-radius:4px;overflow:hidden;">
            <span style="display:block;width:${pct}%;height:100%;background:var(--chart-bar);border-radius:4px;"></span>
          </span>
          <span style="flex:0 0 auto;font-weight:700;color:var(--text);min-width:20px;">${n}</span>
        </div>`;
        })
        .join("");

      const heading =
        providers.length > 1
          ? `<div style="font-size:11px;font-weight:700;color:var(--text-soft);margin:8px 0 2px 0;">${escapeHtml(provider)}<span style="font-weight:400;"> · ${kind.toLowerCase()}</span></div>`
          : `<p style="margin:0 0 4px 0;font-size:11px;color:var(--text-soft);">${matched} matched, by ${kind.toLowerCase()} recommendation</p>`;

      return `${heading}<div role="list">${rows}</div>`;
    })
    .filter(Boolean)
    .join("");

  if (!blocks) return "";

  return `
    <figure style="margin:14px 0 0 0;">
      <figcaption style="font-size:12px;font-weight:600;color:var(--text-body);margin-bottom:6px;">Recommended families</figcaption>
      ${blocks}
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

  const charts = [_matchRateMeter(results), _familyDistribution(results)]
    .filter(Boolean)
    .join("");
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
