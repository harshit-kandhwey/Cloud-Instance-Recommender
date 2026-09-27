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
  vm.runInContext("window._portfolioModel = null; portfolioData = null", ctx);
  vm.runInContext("receivePortfolio({ results: [null, 3] })", ctx);
  check(
    "a payload with no usable rows renders nothing",
    run("window._portfolioModel") === null,
  );
}

process.exitCode = failures ? 1 : 0;
if (!failures) console.log("\nportfolio-hostile-values: all checks passed");
