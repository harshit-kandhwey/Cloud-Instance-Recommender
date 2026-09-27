// Every mix on the App Portfolio is a tally keyed by a cell from the uploaded
// file (ENV, OS, Workload, Compliance tag, no-match reason, instance family). On
// a plain object, a cell that reads "constructor" resolves to an inherited
// function, so the count became a string of function source; "__proto__" set the
// prototype and vanished from the tally. And a handoff payload comes from
// storage or another window, so its shape is not trusted either.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { REPO } = require("../harness");
const els = {};
const fakeEl = (id) =>
  (els[id] ||= {
    id,
    innerHTML: "",
    classList: { add() {}, remove() {}, contains: () => false },
  });
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { origin: "https://x.test", pathname: "/app-portfolio.html" },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
sandbox.window = sandbox;
sandbox.window.opener = null;
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
sandbox.document = {
  readyState: "complete",
  documentElement: { dataset: {} },
  getElementById: fakeEl,
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  head: { appendChild() {} },
  body: { appendChild() {} },
};
const ctx = vm.createContext(sandbox);
for (const rel of ["src/shared/app-core.js", "src/features/portfolio.js"]) {
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
}
const run = (expr) =>
  JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, ctx));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

const HOSTILE = ["constructor", "toString", "__proto__", "hasOwnProperty"];
const rows = HOSTILE.flatMap((v, i) => [
  {
    "VM Name": `a${i}`,
    "App Name": "A",
    "CPU Count": "2",
    "Memory (GB)": "4",
    ENV: v,
    OS: v,
    Workload: v,
    Compliance: v,
    "AWS Like-to-Like Instance": "No data available",
    "AWS No Match Reason": v,
  },
  {
    "VM Name": `b${i}`,
    "App Name": "A",
    "CPU Count": "2",
    "Memory (GB)": "4",
    ENV: v,
    OS: v,
    Workload: v,
    Compliance: v,
    "AWS Like-to-Like Instance": "No data available",
    "AWS No Match Reason": v,
  },
]);
vm.runInContext(
  `__m = buildPortfolioModel({ providers: ["aws"], results: ${JSON.stringify(rows)} })`,
  ctx,
);

console.log("[hostile cell values are counted like any other value]");
for (const [label, expr] of [
  ["app ENV mix", "__m.apps[0].envMix"],
  ["app workload mix", "__m.apps[0].workloadMix"],
  ["estate ENV mix", "__m.estate.envMix"],
  ["estate OS mix", "__m.estate.osMix"],
  ["estate workload totals", "__m.workloadTotals"],
]) {
  const mix = run(expr);
  // Each hostile value appears on 2 rows; the app-level OS mix is normalised by
  // normOS, so only the mixes that keep the raw cell are checked per value.
  const counts = HOSTILE.map((v) =>
    Object.prototype.hasOwnProperty.call(mix, v) ? mix[v] : undefined,
  );
  check(
    `${label}: every hostile value is a number of 2`,
    counts.every((n) => n === 2),
    JSON.stringify(mix),
  );
}
{
  const tags = run("__m.apps[0].compliance");
  check(
    "compliance tags: hostile values are counted (upper-cased)",
    HOSTILE.every((v) => tags[v.toUpperCase()] === 2),
    JSON.stringify(tags),
  );
  const reasons = run("__m.apps[0].noMatchReasons");
  check(
    "no-match reasons: hostile values are counted",
    HOSTILE.every((v) => reasons.some((r) => r.reason === v && r.count === 2)),
    JSON.stringify(reasons),
  );
}

console.log("[hostile keys get a real colour, not an inherited function]");
{
  const colours = run(
    `[${JSON.stringify(HOSTILE)}.map((k) => pfEnvColor(k)), ${JSON.stringify(HOSTILE)}.map((k) => pfOsColor(k)), ${JSON.stringify(HOSTILE)}.map((k) => pfKeyColor(k))]`,
  ).flat();
  check(
    "every colour is a hex string",
    colours.every((c) => /^#[0-9a-f]{6}$/i.test(c)),
    JSON.stringify(colours),
  );
  check(
    "a known category keeps its fixed colour",
    run('pfEnvColor("Production")') === "#dc2626",
  );
}

console.log("[a hostile provider name in the handoff can't inject HTML]");
{
  // providers is sanitized only to a string type by receivePortfolio, not
  // restricted to a known provider name — a hostile string reaching this far
  // must still come out escaped, the same guarantee every other rendered value
  // in this file has.
  // Lower-case tag name: PORTFOLIO_PROVIDER_LABELS has no entry for this string,
  // so the unescaped fallback is p.toUpperCase() — a naive "no <img" check would
  // pass on the un-fixed code too, since toUpperCase renders it as "<IMG ...>".
  const hostile = "<img src=x onerror=alert(1)>";
  const html = run(
    `renderRightSizing({ rightSizing: { ${JSON.stringify(hostile)}: { downsize: 1, same: 0, upsize: 0 } } }, { meta: { providers: [${JSON.stringify(hostile)}] } })`,
  );
  check(
    "a hostile provider name is escaped, not injected as a tag",
    typeof html === "string" && !/<img\b/i.test(html) && html.includes("&lt;"),
    html,
  );

  // Same fix, same untrusted providers list, two more render functions that
  // read PORTFOLIO_PROVIDER_LABELS the same way — the first pass here only
  // covered renderRightSizing and missed these two.
  const estateHtml = run(
    `pfEstateRightSizing({ estate: { rightSizing: { ${JSON.stringify(hostile)}: { downsize: 1, same: 0, upsize: 0 } } }, meta: { providers: [${JSON.stringify(hostile)}] } })`,
  );
  check(
    "pfEstateRightSizing escapes a hostile provider name too",
    typeof estateHtml === "string" &&
      !/<img\b/i.test(estateHtml) &&
      estateHtml.includes("&lt;"),
    estateHtml,
  );
  const familiesHtml = run(
    `renderFamilies({ families: { ${JSON.stringify(hostile)}: { "m5.xlarge": 1 } } }, { meta: { providers: [${JSON.stringify(hostile)}] } })`,
  );
  check(
    "renderFamilies escapes a hostile provider name too",
    typeof familiesHtml === "string" &&
      !/<img\b/i.test(familiesHtml) &&
      familiesHtml.includes("&lt;"),
    familiesHtml,
  );
}

console.log("[a handoff payload of the wrong shape is refused or cleaned]");
{
  const good = { "App Name": "Z", "CPU Count": "1", "Memory (GB)": "1" };
  vm.runInContext(
    `receivePortfolio({ providers: "aws", results: [null, "x", 7, ${JSON.stringify(good)}] })`,
    ctx,
  );
  const m = run("window._portfolioModel");
  check(
    "non-object rows are dropped and a non-array providers list is ignored",
    m &&
      m.estate.vms === 1 &&
      Array.isArray(m.meta.providers) &&
      m.meta.providers.length === 0,
    JSON.stringify(m && m.estate),
  );
  // A payload with no usable rows must be a no-op on whatever the page already
  // has — not merely leave a freshly-nulled model still null, which would pass
  // even if receivePortfolio wrongly cleared a real, already-rendered model.
  const before = run("window._portfolioModel");
  vm.runInContext("receivePortfolio({ results: [null, 3] })", ctx);
  check(
    "a payload with no usable rows leaves the existing model untouched",
    JSON.stringify(run("window._portfolioModel")) === JSON.stringify(before),
  );
}

process.exitCode = failures ? 1 : 0;
if (!failures) console.log("\nportfolio-hostile-values: all checks passed");
