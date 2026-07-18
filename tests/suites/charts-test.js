// Results charts: hand-built, no library (the CSP forbids one), theme tokens
// only, and honest about what they show.
const fs = require("fs");
const path = require("path");
const { REPO, buildContext, makeChecker } = require("./harness");

const { check, state } = makeChecker();

const matched = (name) => ({
  "VM Name": name,
  "CPU Count": "4",
  "Memory (GB)": "16",
  "AWS Like-to-Like Instance": "m5.xlarge",
  "AWS Optimized Instance": "t3.large",
});
const noMatch = (name) => ({
  "VM Name": name,
  "CPU Count": "999",
  "Memory (GB)": "9999",
  "AWS Like-to-Like Instance": "No Match",
  "AWS Optimized Instance": "No Match",
});

const panel = (elements) => elements.resultsChartsSection;

console.log("[the match rate is drawn, and stated]");
{
  // 3 of 4 matched = 75%.
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([
    matched("a"),
    matched("b"),
    matched("c"),
    noMatch("d"),
  ]);
  const html = panel(elements).innerHTML;

  check("the panel is shown", !panel(elements).classes.has("hidden"));
  check("the rate is stated as a number", html.includes("75%"), html);
  check(
    "the meter fill is drawn to that proportion",
    /width:75%/.test(html),
    html.match(/width:\d+%/)?.[0],
  );
  check(
    "the counts are spelled out beside it",
    html.includes("3 matched") && html.includes("1 no match"),
    html.match(/✓[^<]*|✗[^<]*/g)?.join(" ") || "(counts absent)",
  );
  check(
    "and it carries a text alternative, not colour alone",
    /aria-label="3 of 4 rows matched an instance, 75 percent"/.test(html),
    html.match(/aria-label="[^"]*"/)?.[0],
  );
}

console.log("[a rounded rate never contradicts the counts]");
{
  // 199 of 200 = 99.5%, which rounds to 100 — but a row did NOT match. Showing
  // "100%" beside "1 no match" is a small lie that discredits every other number
  // on the page, so the rate is held at 99.
  const many = [];
  for (let i = 0; i < 199; i++) many.push(matched(`ok-${i}`));
  many.push(noMatch("bad"));
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts(many);
  const html = panel(elements).innerHTML;
  // The DISPLAYED figure, not any "100%" in the markup — the meter's own fill
  // carries height:100%, so a bare substring search reads the CSS, not the label.
  const shownPct = (h) => h.match(/>(\d+)%</)?.[1];
  check(
    "99.5% is not rounded up to a perfect 100 while a row is unmatched",
    shownPct(html) === "99",
    `shows ${shownPct(html)}%`,
  );

  // The mirror case: 1 of 300 matched rounds to 0%, which would read as "nothing
  // matched" when something did.
  const few = [matched("only-one")];
  for (let i = 0; i < 299; i++) few.push(noMatch(`bad-${i}`));
  const b = buildContext();
  b.ctx.renderResultsCharts(few);
  const lowHtml = b.elements.resultsChartsSection.innerHTML;
  check(
    "nor down to 0 while a row matched",
    lowHtml.match(/>(\d+)%</)?.[1] === "1",
    `shows ${lowHtml.match(/>(\d+)%</)?.[1]}%`,
  );
}

console.log("[a clean sweep says 100%, with no phantom no-match]");
{
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([matched("a"), matched("b")]);
  const html = panel(elements).innerHTML;
  check("100% when every row matched", html.includes("100%"));
  check("and no 'no match' clause at all", !html.includes("no match"), html);
}

// A row landing on a given family, per provider. Optimized and Like-to-Like are
// given DIFFERENT families on purpose, so a test can tell which one the chart
// counted — the chart should prefer the optimized recommendation.
const famRow = (name, { awsOpt, awsL2l, azOpt } = {}) => {
  const row = { "VM Name": name };
  if (awsOpt || awsL2l) {
    row["AWS Like-to-Like Instance"] = "m5.xlarge";
    row["AWS Like-to-Like Family"] = awsL2l || "General purpose";
    row["AWS Optimized Instance"] = "t3.large";
    row["AWS Optimized Family"] = awsOpt || "General purpose";
  }
  if (azOpt) {
    row["AZURE Optimized Instance"] = "d2sv5";
    row["AZURE Optimized Family"] = azOpt;
  }
  return row;
};
// A no-match AWS row, exactly as the factory writes one: the instance cell is a
// real sentinel ("Missing data") and the family cell its "N/A" placeholder. The
// chart must recognise it by the instance cell — if it instead trusted the
// family string, counting "N/A" as a family would slip through the day the
// placeholder text changes.
const famNoMatch = (name) => ({
  "VM Name": name,
  "AWS Like-to-Like Instance": "Missing data",
  "AWS Like-to-Like Family": "N/A",
  "AWS Optimized Instance": "Missing data",
  "AWS Optimized Family": "N/A",
});

console.log("[family distribution counts the families it landed on]");
{
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([
    famRow("a", { awsOpt: "General purpose" }),
    famRow("b", { awsOpt: "General purpose" }),
    famRow("c", { awsOpt: "Compute optimized" }),
    famNoMatch("d"), // must not become a phantom "N/A" bar
  ]);
  const html = panel(elements).innerHTML;

  check("the section is titled", html.includes("Recommended families"), html);
  check(
    "each landed-on family is named",
    html.includes("General purpose") && html.includes("Compute optimized"),
    html,
  );
  // Two on General purpose, one on Compute optimized, counted honestly.
  check(
    "General purpose carries its count of 2",
    /General purpose<\/span>[\s\S]*?>2<\/span>/.test(html),
    html.match(/General purpose[\s\S]{0,220}?<\/span>/)?.[0],
  );
  check(
    "a no-match row does not invent an N/A family",
    !html.includes(">N/A<") && !/title="N\/A"/.test(html),
    html,
  );
  check(
    "the single-provider heading counts only matched rows",
    html.includes("3 matched"),
    html.match(/\d+ matched[^<]*/)?.[0],
  );
  // Most-common first: General purpose (2) must appear before Compute
  // optimized (1) in document order.
  check(
    "families are ordered most-common first",
    html.indexOf("General purpose") < html.indexOf("Compute optimized"),
  );
}

console.log("[it charts the optimized recommendation, not the like-for-like]");
{
  // Optimized landed on Compute optimized; like-for-like on Memory optimized.
  // The chart describes what you would deploy — the optimized set — so Memory
  // optimized must not appear at all.
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([
    famRow("a", { awsOpt: "Compute optimized", awsL2l: "Memory optimized" }),
  ]);
  const html = panel(elements).innerHTML;
  check("the optimized family is shown", html.includes("Compute optimized"));
  check(
    "and the like-for-like family is not",
    !html.includes("Memory optimized"),
    html,
  );
  check("the heading names the optimized basis", html.includes("optimized"));
}

console.log("[a like-for-like-only run falls back to that family]");
{
  // No Optimized Family column exists, so the chart must read the like-to-like
  // family rather than showing nothing.
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([
    {
      "VM Name": "a",
      "AWS Like-to-Like Instance": "m5.xlarge",
      "AWS Like-to-Like Family": "Storage optimized",
    },
  ]);
  const html = panel(elements).innerHTML;
  check(
    "the like-for-like family is charted",
    html.includes("Storage optimized"),
  );
  check(
    "and the heading says like-to-like",
    /like-to-like/i.test(html),
    html.match(/\d+ matched[^<]*/)?.[0],
  );
}

console.log("[each provider gets its own block, labels never merged]");
{
  // The category LABELS differ across clouds and must not be pooled: keep one
  // block per provider, each naming its provider.
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([
    famRow("a", { awsOpt: "General purpose", azOpt: "General purpose" }),
    famRow("b", { awsOpt: "Compute optimized", azOpt: "General purpose" }),
  ]);
  const html = panel(elements).innerHTML;
  check("AWS is named as its own block", html.includes("AWS"), html);
  check("AZURE is named as its own block", html.includes("AZURE"), html);
}

console.log("[family names are escaped, never injected]");
{
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([
    famRow("a", { awsOpt: "<img src=x onerror=alert(1)>" }),
  ]);
  const html = panel(elements).innerHTML;
  check(
    "an angle bracket in a family name is escaped",
    html.includes("&lt;img") && !html.includes("<img src=x"),
    html.match(/&lt;img[^"]*|<img src=x[^>]*/)?.[0],
  );
}

// A row with a like-for-like baseline and an optimized recommendation, so
// computeSizingSavings has a before and an after to compare.
const baRow = (name, { l2lCpu, l2lMem, optCpu, optMem, p = "AWS" }) => ({
  "VM Name": name,
  [`${p} Like-to-Like Instance`]: "m5.xlarge",
  [`${p} Like-to-Like vCPUs`]: l2lCpu,
  [`${p} Like-to-Like Memory (GiB)`]: l2lMem,
  [`${p} Optimized Instance`]: "t3.large",
  [`${p} Optimized vCPUs`]: optCpu,
  [`${p} Optimized Memory (GiB)`]: optMem,
});

console.log("[vCPU and RAM are each their own before→after chart]");
{
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([
    baRow("a", { l2lCpu: 8, l2lMem: 32, optCpu: 4, optMem: 16 }),
  ]);
  const html = panel(elements).innerHTML;

  check(
    "there is a vCPU before→after chart",
    html.includes("vCPU: before → after"),
    html,
  );
  check(
    "there is a separate Memory before→after chart",
    html.includes("Memory: before → after"),
    html,
  );
  // Two charts, never one dual-axis chart: exactly two before→after figures,
  // counted by their captions (the phrase also appears in each aria-label).
  const captions =
    html.match(/<figcaption[^>]*>[^<]*before → after<\/figcaption>/g) || [];
  check(
    "the two measures are two charts, not one shared axis",
    captions.length === 2,
    `${captions.length} chart caption(s)`,
  );
  check(
    "the vCPU endpoints are stated: 8 before, 4 after",
    /8 → 4 vCPU/.test(html),
    html.match(/aria-label="vCPU[^"]*"/)?.[0],
  );
  check(
    "the memory endpoints are stated: 32 before, 16 after",
    /32 → 16 GiB/.test(html),
    html.match(/aria-label="Memory[^"]*"/)?.[0],
  );
  // Direction is carried by the aria-label, never colour alone.
  check(
    "each chart carries a text alternative naming the baseline",
    /aria-label="vCPU[^"]*vs like-for-like"/.test(html),
  );
  // Before and after are visually distinct: the de-emphasis gray vs the hue.
  check(
    "before wears the context gray and after the emphasis hue",
    html.includes("var(--chart-context)") && html.includes("var(--chart-bar)"),
  );
}

console.log("[a before→after endpoint pair reconstructs the reported delta]");
{
  // The chart's endpoints and the stats bar's savings delta come from the same
  // primitive, so they can never disagree: before − after === the delta.
  const { ctx } = buildContext();
  const savings = ctx.computeSizingSavings([
    baRow("a", { l2lCpu: 8, l2lMem: 32, optCpu: 4, optMem: 16 }),
    baRow("b", { l2lCpu: 2, l2lMem: 8, optCpu: 2, optMem: 4 }),
  ]);
  const s = savings[0];
  check(
    "beforeVcpus − afterVcpus equals the vcpus delta",
    s.beforeVcpus - s.afterVcpus === s.vcpus,
    JSON.stringify(s),
  );
  check(
    "beforeMemory − afterMemory equals the memory delta",
    s.beforeMemory - s.afterMemory === s.memory,
    JSON.stringify(s),
  );
}

console.log("[an axis that did not move is not drawn as equal bars]");
{
  // vCPU is identical before and after; only memory changed. The vCPU chart
  // would be two equal bars saying nothing, so it is omitted; memory remains.
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([
    baRow("a", { l2lCpu: 4, l2lMem: 32, optCpu: 4, optMem: 16 }),
  ]);
  const html = panel(elements).innerHTML;
  check(
    "the unchanged vCPU axis is omitted",
    !html.includes("vCPU: before → after"),
    html,
  );
  check(
    "the changed memory axis is still drawn",
    html.includes("Memory: before → after"),
  );
}

console.log("[an optimized-only run compares against the current size]");
{
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([
    {
      "VM Name": "a",
      "CPU Count": "8",
      "Memory (GB)": "32",
      "AWS Optimized Instance": "m5.large",
      "AWS Optimized vCPUs": 4,
      "AWS Optimized Memory (GiB)": 16,
    },
  ]);
  const html = panel(elements).innerHTML;
  check(
    "the baseline is named as the current size, not like-for-like",
    /vs current size/.test(html) && !/vs like-for-like/.test(html),
    html.match(/aria-label="vCPU[^"]*"/)?.[0],
  );
}

console.log("[upsizing is charted as plainly as downsizing]");
{
  // Optimized is LARGER than the baseline (an honest outcome when the current
  // box was undersized). The after bar must simply be the longer one.
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([
    baRow("a", { l2lCpu: 2, l2lMem: 8, optCpu: 4, optMem: 8 }),
  ]);
  const html = panel(elements).innerHTML;
  check(
    "an upsized vCPU is shown going up, not hidden",
    /2 → 4 vCPU/.test(html),
    html.match(/aria-label="vCPU[^"]*"/)?.[0],
  );
}

console.log("[a like-for-like-only run draws no before→after]");
{
  // No optimized columns, so there is no "after" — the charts must simply not
  // appear rather than inventing one.
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([
    {
      "VM Name": "a",
      "AWS Like-to-Like Instance": "m5.large",
      "AWS Like-to-Like vCPUs": 2,
      "AWS Like-to-Like Memory (GiB)": 8,
    },
  ]);
  const html = panel(elements).innerHTML;
  check(
    "no before→after chart is drawn",
    !html.includes("before → after"),
    html,
  );
}

console.log("[the renderer survives a page that has no placeholder]");
{
  // Four pages, one renderer: a page missing the panel must lose the charts, not
  // throw and take the results down with it.
  const { ctx } = buildContext({ missingElements: ["resultsChartsSection"] });
  let threw = null;
  let returned;
  try {
    returned = ctx.renderResultsCharts([matched("a")]);
  } catch (e) {
    threw = e;
  }
  check("it does not throw", threw === null, threw && threw.message);
  check("and reports that there was nowhere to draw", returned === false);
}

console.log("[nothing to draw is drawn as nothing]");
{
  const { ctx, elements } = buildContext();
  ctx.renderResultsCharts([]);
  check(
    "an empty result set hides the panel rather than showing an empty frame",
    panel(elements).classes.has("hidden") && panel(elements).innerHTML === "",
  );
}

console.log("[no library, no literal colours]");
{
  const src = fs.readFileSync(path.join(REPO, "js/base/charts.js"), "utf8");
  // The CSP is script-src 'self'; connect-src 'none'. A chart library could only
  // arrive by injected script or fetch, and neither is available — so the guard
  // is that the module never reaches for one.
  check(
    "the module loads no script and fetches nothing",
    !/\bfetch\s*\(|XMLHttpRequest|createElement\(["']script|import\s*\(/.test(
      src,
    ),
    "charts.js reaches outside the page",
  );
  // Colours come from theme.css tokens so both themes are deliberate. A literal
  // colour here would be invisible to the theme and wrong in one mode or the
  // other. This guard used to match hex only, which let rgb()/hsl() through —
  // they bypass the tokens just as completely, so the guard was reporting a
  // safety it had never checked. The check is named for what it actually tests.
  const literals =
    src.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\([^)]*\)/g) || [];
  check(
    "no literal hex, rgb() or hsl() colours — every mark wears a token",
    literals.length === 0,
    literals.join(", "),
  );
  check(
    "the marks use the chart tokens",
    /var\(--good-strong\)/.test(src) && /var\(--success-bg\)/.test(src),
  );
}

process.exit(state.failures ? 1 : 0);
