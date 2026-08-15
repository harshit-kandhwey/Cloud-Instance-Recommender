// Results charts. No charting library by policy (dependency-free, no CDN); CSP
// would permit a vendored one. Rendered into #resultsChartsSection by
// renderResultsCharts(); tolerates a missing placeholder (no charts, no throw).
// Colours are theme tokens chosen per theme against its surface (css/theme.css);
// mark colours never double as label colours.

// ─── Match rate ───────────────────────────────────────────────────────────────
// One ratio of a whole → a meter, not a two-slice donut (a length reads a ratio
// exactly; two pie angles do not). Number stated in text beside the bar.
function _matchRateMeter(results) {
  const instanceCols = getInstanceColumns(results);
  if (!instanceCols.length) return "";

  const total = results.length;
  const unmatched = results.filter((row) =>
    rowIsAllNoMatch(row, instanceCols),
  ).length;
  const matched = total - unmatched;
  // Clamp rounding so the % never contradicts the counts: no 100% with an
  // unmatched row, no 0% with a matched one.
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
// Count of recommendations per family category ("General purpose", …), read from
// the provider-assigned family field carried on the row since 3.8.5 (Azure's
// family is not derivable from the instance name). Horizontal bar per category,
// one hue — identity is the axis label, no legend. Per provider: category labels
// differ across clouds (AWS "GPU instance" vs Azure "GPU" vs GCP "Accelerator
// optimized") and must not be merged. Category count is small (~6–9) by design,
// so nothing folds into an "Other".
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
      // Prefer the optimized recommendation (what you'd deploy) over like-for-like.
      const kind = keys.includes(`${provider} Optimized Family`)
        ? "Optimized"
        : "Like-to-Like";
      const instanceCol = `${provider} ${kind} Instance`;
      const familyCol = `${provider} ${kind} Family`;

      // Tally families only over matched rows: a no-match row's "N/A"/"Error"
      // placeholder would invent a category. The !family check guards an empty
      // family name in the data, not a second no-match test.
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
// Baseline vs optimized footprint per provider. Two charts, not one dual-axis:
// vCPU and GiB are different units/scales. Before = de-emphasis gray, after =
// emphasis hue (direction read without a legend); bars direct-labelled, one scale
// per chart (max endpoint across providers). Never summed across providers — the
// same VM appears once per provider, so a total would double/triple-count it.
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
      // Skip a measure that didn't move on any provider (all bars equal).
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

      // Accessible summary so direction of change is never colour-alone.
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
// Returns false when the page has no placeholder — distinguishes "nothing to
// draw" from "nowhere to draw it".
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
// One-page print/PDF summary built from the SAME primitives as the on-screen
// charts, so printed figures can't disagree with them. Stat tiles (verdict as a
// single number) + the three charts. Hidden in-page (downloads.js wires the
// button; style.css shows it only on print and forces light tokens). Kept beside
// the chart builders it reuses to avoid cross-file load-order coupling.

// Headline: what the run assessed and what optimizing bought, as stat tiles + a
// per-provider right-sizing line, from the shared primitives.
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

  // Per-provider right-sizing, worded as the stats bar does: positive delta =
  // reduction ("−"), negative = increase ("+").
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

// Full report: header, headline, three charts. "" for an empty result set.
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

// Populates the hidden report container. Like renderResultsCharts, returns false
// when the page has no placeholder.
function renderExecutiveReport(results) {
  const el = document.getElementById("executiveReportSection");
  if (!el) return false;
  el.innerHTML = results && results.length ? buildExecutiveReport(results) : "";
  return true;
}
window.buildExecutiveReport = buildExecutiveReport;
window.renderExecutiveReport = renderExecutiveReport;
