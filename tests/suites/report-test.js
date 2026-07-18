// Executive print report: a one-page summary built from the SAME primitives as
// the on-screen charts (so the printed figures can never disagree with them),
// composed as stat tiles plus the three charts. Lives hidden in the page and is
// revealed only when printing.
const fs = require("fs");
const path = require("path");
const { REPO, buildContext, makeChecker } = require("./harness");

const { check, state } = makeChecker();

// A fully-matched AWS row carrying everything the three charts read: instance
// cells (match rate), a family category (family distribution), and a like-for-
// like baseline against an optimized pick (before → after / right-sizing).
const rich = (name, app) => ({
  "VM Name": name,
  "App Name": app || "",
  "CPU Count": "8",
  "Memory (GB)": "32",
  "AWS Like-to-Like Instance": "m5.2xlarge",
  "AWS Like-to-Like vCPUs": 8,
  "AWS Like-to-Like Memory (GiB)": 32,
  "AWS Like-to-Like Family": "General purpose",
  "AWS Optimized Instance": "m5.xlarge",
  "AWS Optimized vCPUs": 4,
  "AWS Optimized Memory (GiB)": 16,
  "AWS Optimized Family": "General purpose",
});
// A row no provider could place — both instance cells are no-match sentinels.
const nm = (name) => ({
  "VM Name": name,
  "App Name": "",
  "CPU Count": "999",
  "Memory (GB)": "9999",
  "AWS Like-to-Like Instance": "No Match",
  "AWS Like-to-Like Family": "N/A",
  "AWS Optimized Instance": "No Match",
  "AWS Optimized Family": "N/A",
});

const report = (elements) => elements.executiveReportSection.innerHTML;

console.log("[the report leads with headline stat tiles]");
{
  // 3 of 4 matched, both on named apps → 75%, 1 no match, 2 apps.
  const { ctx, elements } = buildContext();
  ctx.renderExecutiveReport([
    rich("a", "Billing"),
    rich("b", "Billing"),
    rich("c", "Search"),
    nm("d"),
  ]);
  const html = report(elements);

  check("it is titled as an executive summary", /Executive summary/.test(html));
  check(
    "the VMs-assessed tile counts every row",
    /VMs assessed/.test(html) && />4<\/div>|>4 </.test(html),
    html.match(/>[\d,]+<\/div>\s*<div[^>]*>VMs assessed/)?.[0],
  );
  check(
    "the matched tile carries the count and rate",
    /Matched/.test(html) && html.includes("(75%)") && />3 /.test(html),
    html.match(/>3[\s\S]{0,80}?Matched/)?.[0],
  );
  check(
    "a no-match tile appears only because a row went unmatched",
    /No match/.test(html),
    html,
  );
  check(
    "the applications tile counts the distinct named apps",
    /Applications/.test(html) &&
      />2<\/div>\s*<div[^>]*>Applications/.test(html),
    html.match(/>[\d,]+<\/div>\s*<div[^>]*>Applications/)?.[0],
  );
}

console.log("[the report embeds all three charts, unchanged]");
{
  const { ctx, elements } = buildContext();
  ctx.renderExecutiveReport([rich("a"), rich("b"), nm("c")]);
  const html = report(elements);

  check("the match-rate meter is embedded", /Match rate/.test(html), html);
  check(
    "the family distribution is embedded",
    /Recommended families/.test(html),
    html,
  );
  check(
    "the before → after charts are embedded",
    html.includes("before → after"),
    html,
  );
}

console.log("[the right-sizing headline restates the sizing delta]");
{
  // Two matched rich rows: before 16 vCPU / 64 GiB, after 8 / 32 → −8 vCPU,
  // −32 GB against the like-for-like baseline. Same primitive as the stats bar.
  const { ctx, elements } = buildContext();
  ctx.renderExecutiveReport([rich("a"), rich("b")]);
  const html = report(elements);
  check("a right-sizing section is present", /Right-sizing/.test(html), html);
  check(
    "the vCPU saving is stated as a reduction",
    html.includes("−8 vCPU"),
    html.match(/−?\+?\d+ vCPU[^<]*/)?.[0],
  );
  check(
    "the memory saving is stated as a reduction",
    html.includes("−32 GB"),
    html.match(/−?\+?\d+ GB[^<]*/)?.[0],
  );
  check(
    "the baseline is named",
    html.includes("vs like-for-like"),
    html.match(/vs [a-z-]+/)?.[0],
  );
}

console.log("[a clean sweep shows no no-match tile]");
{
  // Every row matched and none carry an App Name → neither the no-match tile
  // nor the applications tile should appear (a tile that always shows is noise).
  const { ctx, elements } = buildContext();
  ctx.renderExecutiveReport([rich("a"), rich("b")]);
  const html = report(elements);
  check("no no-match tile when nothing went unmatched", !/No match/.test(html));
  check(
    "no applications tile when no row is named",
    !/Applications/.test(html),
    html,
  );
  check("the matched tile reads 100%", html.includes("(100%)"), html);
}

console.log("[the report is dated and stamped with the data vintage]");
{
  const { ctx, elements } = buildContext();
  ctx.renderExecutiveReport([rich("a")]);
  const html = report(elements);
  check("it states when it was generated", /Generated /.test(html), html);
  // The AWS data file sets AWS_DATA_DATE in the sandbox, so the vintage line
  // must appear rather than being silently dropped.
  check(
    "it states the data vintage",
    /Data as of /.test(html),
    html.match(/Generated[^<]*/)?.[0],
  );
}

console.log("[family names in the report are escaped, never injected]");
{
  const row = rich("a");
  row["AWS Optimized Family"] = "<img src=x onerror=alert(1)>";
  const { ctx, elements } = buildContext();
  ctx.renderExecutiveReport([row]);
  const html = report(elements);
  check(
    "an angle bracket in a family name is escaped",
    html.includes("&lt;img") && !html.includes("<img src=x"),
    html.match(/&lt;img[^"]*|<img src=x[^>]*/)?.[0],
  );
}

console.log("[the renderer survives a page that has no report placeholder]");
{
  // Four pages, one renderer: a page missing the container must not throw.
  const { ctx } = buildContext({ missingElements: ["executiveReportSection"] });
  let threw = null;
  let returned;
  try {
    returned = ctx.renderExecutiveReport([rich("a")]);
  } catch (e) {
    threw = e;
  }
  check("it does not throw", threw === null, threw && threw.message);
  check("and reports there was nowhere to draw", returned === false);
}

console.log("[an empty result set clears the report rather than framing it]");
{
  const { ctx, elements } = buildContext();
  ctx.renderExecutiveReport([]);
  check(
    "the container is emptied, and the renderer reports it drew nothing to it",
    report(elements) === "",
  );
  check(
    "buildExecutiveReport returns empty for no results",
    ctx.buildExecutiveReport([]) === "",
  );
}

console.log("[the print trigger is scoped, not a bare window.print]");
{
  // The trigger must gate the print stylesheet behind a body class, so a plain
  // Ctrl+P prints the page as seen and other pages sharing style.css never print
  // blank. The style hook and its class must therefore both exist.
  const css = fs.readFileSync(path.join(REPO, "css/style.css"), "utf8");
  check(
    "the print stylesheet is scoped to a deliberate .printing-report press",
    /body\.printing-report/.test(css) && /@media print/.test(css),
    "print rules are unscoped",
  );
  const dl = fs.readFileSync(path.join(REPO, "js/base/downloads.js"), "utf8");
  check(
    "printExecutiveReport adds the scoping class before printing",
    /printing-report/.test(dl) && /window\.print\(\)/.test(dl),
  );
  check(
    "and it removes the class again on afterprint",
    /afterprint/.test(dl) && /remove\(["']printing-report["']\)/.test(dl),
  );
}

process.exit(state.failures ? 1 : 0);
