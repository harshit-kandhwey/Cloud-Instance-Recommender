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
  // hex here would be invisible to the theme and wrong in one mode or the other.
  const hexes = src.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  check(
    "no literal hex colours — every mark wears a token",
    hexes.length === 0,
    hexes.join(", "),
  );
  check(
    "the marks use the chart tokens",
    /var\(--good-strong\)/.test(src) && /var\(--success-bg\)/.test(src),
  );
}

process.exit(state.failures ? 1 : 0);
