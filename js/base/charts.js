// Results charts. Hand-built, no charting library — a deliberate choice, not a
// restriction. `script-src 'self'` permits same-origin scripts, so a vendored
// library would load exactly the way SheetJS already does (js/vendor/, injected
// by ingest.js and portfolio.js); `connect-src 'none'` blocks network
// connections, not script execution. Staying dependency-free is the project's
// policy — no CDN, no supply-chain surface, a CSP that stays tight — and nothing
// here needs a library anyway.
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

// ─── vCPU / RAM before → after ──────────────────────────────────────────────
// What optimizing did to the fleet's size, per provider: the total baseline
// footprint against the total optimized footprint. TWO charts, never one with
// two y-axes — vCPU and GiB are different units on different scales, and a
// shared axis would imply a crossover wherever the two happen to be zeroed.
//
// "Before" wears the de-emphasis gray and "after" the emphasis hue, so the eye
// reads the direction of change without a legend; each bar is direct-labelled
// with its value. Bars share one scale per chart (the max across providers of
// either endpoint) so a longer bar always means more. Never summed across
// providers — the same VM appears once per provider, so a combined total would
// count it two or three times; each provider is its own small multiple.
function _beforeAfter(results) {
  const savings =
    typeof computeSizingSavings === "function"
      ? computeSizingSavings(results)
      : [];
  if (!savings.length) return "";

  const measures = [
    {
      caption: "vCPU: before → after",
      before: "beforeVcpus",
      after: "afterVcpus",
      unit: "vCPU",
    },
    {
      caption: "Memory: before → after",
      before: "beforeMemory",
      after: "afterMemory",
      unit: "GiB",
    },
  ];

  const charts = measures
    .map(({ caption, before, after, unit }) => {
      // A measure with no movement on any provider is an axis of equal bars —
      // honest but empty; the other chart carries whatever did change.
      if (savings.every((s) => s[before] === s[after])) return "";

      const scale = Math.max(
        1,
        ...savings.map((s) => Math.max(s[before], s[after])),
      );

      const providerBlocks = savings
        .map((s) => {
          const bar = (label, value, color) => {
            const pct = Math.round((value / scale) * 100);
            return `
        <div style="display:flex;align-items:center;gap:8px;margin:2px 0;font-size:12px;">
          <span style="flex:0 0 52px;color:var(--text-soft);text-align:right;">${label}</span>
          <span style="flex:1;min-width:60px;height:14px;background:var(--success-bg);border-radius:4px;overflow:hidden;">
            <span style="display:block;width:${pct}%;height:100%;background:${color};border-radius:4px;"></span>
          </span>
          <span style="flex:0 0 auto;font-weight:700;color:var(--text);min-width:28px;">${value}</span>
        </div>`;
          };

          const heading =
            savings.length > 1
              ? `<div style="font-size:11px;font-weight:700;color:var(--text-soft);margin:6px 0 1px 0;">${escapeHtml(s.provider)}</div>`
              : "";

          return `${heading}
        ${bar("Before", s[before], "var(--chart-context)")}
        ${bar("After", s[after], "var(--chart-bar)")}`;
        })
        .join("");

      // One-line accessible summary, so the direction of change is never
      // colour-alone.
      const summary = savings
        .map(
          (s) =>
            `${s.provider}: ${s[before]} → ${s[after]} ${unit} vs ${s.baseline}`,
        )
        .join("; ");

      return `
      <figure style="margin:14px 0 0 0;" role="img" aria-label="${escapeHtml(caption)}. ${escapeHtml(summary)}">
        <figcaption style="font-size:12px;font-weight:600;color:var(--text-body);margin-bottom:2px;">${caption}</figcaption>
        ${providerBlocks}
      </figure>`;
    })
    .filter(Boolean)
    .join("");

  return charts;
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

  const charts = [
    _matchRateMeter(results),
    _familyDistribution(results),
    _beforeAfter(results),
  ]
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

// ─── Executive print report ─────────────────────────────────────────────────
// A one-page summary meant for paper (or PDF), built from the SAME primitives as
// the on-screen charts so the printed figures can never disagree with the ones
// above the table. It composes headline stat tiles — the single-number form for
// a verdict, per the dataviz method — with the three charts unchanged.
//
// It lives hidden in the page (js/base/report.js wires the button; css/style.css
// hides it on screen and reveals only it on print, forcing light tokens so a
// dark-theme screen never prints an ink-heavy background). Kept beside the chart
// builders it reuses rather than in its own file, so those figures are one call
// away and nothing depends on cross-file load order.

// The headline: what the run assessed and what optimizing bought, as stat tiles
// and a per-provider right-sizing line. Numbers come from the shared primitives
// (getInstanceColumns / rowIsAllNoMatch / computeSizingSavings), the same ones
// the meter and the stats bar read — so every figure on the page is one number.
function _reportHeadline(results) {
  const instanceCols =
    typeof getInstanceColumns === "function" ? getInstanceColumns(results) : [];
  const total = results.length;
  const unmatched = instanceCols.length
    ? results.filter((row) => rowIsAllNoMatch(row, instanceCols)).length
    : 0;
  const matched = total - unmatched;
  const pct = total ? Math.round((matched / total) * 100) : 0;

  const keys = Object.keys(results[0] || {});
  const appCount = keys.includes("App Name")
    ? new Set(
        results.map((r) => String(r["App Name"] || "").trim()).filter(Boolean),
      ).size
    : 0;

  const tile = (label, value, accent) => `
      <div style="flex:1 1 130px;min-width:130px;border:1px solid var(--border-slate-light);border-radius:8px;padding:10px 12px;background:var(--surface-tint);">
        <div style="font-size:22px;font-weight:800;line-height:1.1;color:${accent || "var(--text)"};">${value}</div>
        <div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--text-soft);margin-top:3px;">${label}</div>
      </div>`;

  const tiles = [
    tile("VMs assessed", total.toLocaleString()),
    tile(
      "Matched",
      `${matched.toLocaleString()} <span style="font-size:13px;font-weight:600;">(${pct}%)</span>`,
      "var(--good-strong)",
    ),
    unmatched > 0
      ? tile("No match", unmatched.toLocaleString(), "var(--red-strong)")
      : "",
    appCount > 0 ? tile("Applications", appCount.toLocaleString()) : "",
  ]
    .filter(Boolean)
    .join("");

  // Per-provider right-sizing, worded exactly as the stats bar words it: a
  // positive delta is a reduction (shown "−"), a negative one an increase ("+").
  const savings =
    typeof computeSizingSavings === "function"
      ? computeSizingSavings(results)
      : [];
  const savingsLines = savings
    .map((s) => {
      const parts = [];
      if (s.vcpus !== 0)
        parts.push(`${s.vcpus > 0 ? "−" : "+"}${Math.abs(s.vcpus)} vCPU`);
      if (s.memory !== 0)
        parts.push(`${s.memory > 0 ? "−" : "+"}${Math.abs(s.memory)} GB`);
      if (!parts.length) return "";
      const win = s.vcpus >= 0 && s.memory >= 0;
      const color = win ? "var(--good-strong)" : "var(--amber-strong)";
      return `
        <div style="font-size:12px;margin:2px 0;color:var(--text-body);">
          <strong style="color:var(--text);">${escapeHtml(s.provider)}</strong>
          <span style="color:${color};font-weight:700;"> ${parts.join(" · ")}</span>
          <span style="color:var(--text-soft);"> vs ${escapeHtml(s.baseline)}</span>
        </div>`;
    })
    .filter(Boolean)
    .join("");

  const savingsBlock = savingsLines
    ? `<figure style="margin:14px 0 0 0;">
        <figcaption style="font-size:12px;font-weight:600;color:var(--text-body);margin-bottom:4px;">Right-sizing</figcaption>
        ${savingsLines}
      </figure>`
    : "";

  return `
    <div style="display:flex;flex-wrap:wrap;gap:10px;">${tiles}</div>
    ${savingsBlock}`;
}

// The full report: a titled header, the headline, then the three charts. Returns
// "" for an empty result set so a caller can tell "nothing to report" from a
// populated page.
function buildExecutiveReport(results) {
  if (!results || !results.length) return "";

  const dates = [
    typeof window !== "undefined" ? window.AWS_DATA_DATE : undefined,
    typeof window !== "undefined" ? window.AZURE_DATA_DATE : undefined,
    typeof window !== "undefined" ? window.GCP_DATA_DATE : undefined,
  ]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  const asOf = dates.length
    ? ` · Data as of ${escapeHtml(dates.join(" / "))}`
    : "";
  const generated = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const charts = [
    _matchRateMeter(results),
    _familyDistribution(results),
    _beforeAfter(results),
  ]
    .filter(Boolean)
    .join("");

  return `
    <section style="max-width:760px;margin:0 auto;padding:20px 24px;color:var(--text);background:var(--surface);font-family:inherit;">
      <header style="border-bottom:2px solid var(--border-slate-light);padding-bottom:10px;margin-bottom:16px;">
        <h1 style="margin:0;font-size:20px;font-weight:800;color:var(--heading-indigo);">Executive summary</h1>
        <p style="margin:2px 0 0 0;font-size:13px;color:var(--text-body);">Cloud instance recommendations</p>
        <p style="margin:6px 0 0 0;font-size:11px;color:var(--text-soft);">Generated ${escapeHtml(generated)}${asOf}</p>
      </header>
      ${_reportHeadline(results)}
      ${charts}
    </section>`;
}

// Populates the always-present-but-hidden report container. Mirrors
// renderResultsCharts: returns false when the page has no placeholder, so a
// caller can tell "nowhere to draw" from "nothing to draw".
function renderExecutiveReport(results) {
  const el = document.getElementById("executiveReportSection");
  if (!el) return false;
  el.innerHTML = results && results.length ? buildExecutiveReport(results) : "";
  return true;
}
window.buildExecutiveReport = buildExecutiveReport;
window.renderExecutiveReport = renderExecutiveReport;
