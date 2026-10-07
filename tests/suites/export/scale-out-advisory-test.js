// Scale-out advisory (3.21 phase 6, E8): a VM idle at its median that still spikes
// near saturation is a horizontal-scaling candidate. Covered: the classifier's
// thresholds and its refusal to judge without both readings, the Portfolio panel,
// estate callout and VM-detail column. The App Summary CSV column is covered in
// app-summary-test.js, where the tool-page modules are loaded.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();

function fakeEl() {
  return {
    innerHTML: "",
    classList: { add() {}, remove() {}, contains: () => false },
  };
}
const sandbox = {
  console: { log() {}, warn() {}, error() {} },
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
  getElementById: () => fakeEl(),
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  head: { appendChild() {} },
  body: { appendChild() {} },
};
const ctx = vm.createContext(sandbox);
const load = (rel) =>
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
load("src/shared/storage-keys.js");
load("src/shared/app-core.js");
load("src/features/portfolio.js");
const run = (expr) => vm.runInContext(expr, ctx);
const classify = (row) => {
  ctx.__row = row;
  return run("classifyScaleOut(__row)");
};

const P50 = "CPU Utilization p50";
const PEAK = "CPU Utilization Peak";

console.log("[the classifier's thresholds]");
check(
  "a low median with a high peak is a candidate, with its reason",
  (() => {
    const r = classify({ [P50]: "12", [PEAK]: "94" });
    return (
      r.evaluated &&
      r.candidate &&
      r.reasons.join() === "CPU: low p50 (12%), high Peak (94%)"
    );
  })(),
  JSON.stringify(classify({ [P50]: "12", [PEAK]: "94" })),
);
check(
  "the edges are inclusive: p50 20 and Peak 80 qualify; 21 and 79 do not",
  classify({ [P50]: "20", [PEAK]: "80" }).candidate &&
    !classify({ [P50]: "21", [PEAK]: "80" }).candidate &&
    !classify({ [P50]: "20", [PEAK]: "79" }).candidate,
);
check(
  "a steadily busy VM (high median, high peak) is judged and is not a candidate",
  (() => {
    const r = classify({ [P50]: "70", [PEAK]: "95" });
    return r.evaluated && !r.candidate;
  })(),
);
check(
  "memory is judged on its own columns, and both reasons are listed",
  classify({
    [P50]: "10",
    [PEAK]: "90",
    "Memory Utilization p50": "15",
    "Memory Utilization Peak": "85",
  }).reasons.length === 2,
);

check(
  "a reading with a percent sign counts, as it does when the row is sized",
  (() => {
    const r = classify({ [P50]: "12%", [PEAK]: "94%" });
    return r.evaluated && r.candidate;
  })(),
);

console.log("[a row that cannot be judged is not 'not a candidate']");
check(
  "median only, peak only, or neither: not evaluated",
  [{ [P50]: "10" }, { [PEAK]: "95" }, {}].every((row) => {
    const r = classify(row);
    return !r.evaluated && !r.candidate;
  }),
);
check(
  "junk, zero, negative and over-100 readings do not count as readings",
  ["n/a", "0", "-5", "101", "  ", ""].every((junk) => {
    const a = classify({ [P50]: junk, [PEAK]: "95" });
    const b = classify({ [P50]: "10", [PEAK]: junk });
    return !a.evaluated && !b.evaluated;
  }),
);
check(
  "an inherited column is never a reading",
  !classify(Object.create({ [P50]: "10", [PEAK]: "95" })).evaluated,
);
check(
  "the average and p95 alone cannot make a candidate",
  !classify({ "CPU Utilization": "10", "CPU Utilization p95": "95" }).evaluated,
);

console.log("[the Portfolio page]");
const row = (name, app, extra) => ({
  "VM Name": name,
  "App Name": app,
  "CPU Count": "4",
  "Memory (GB)": "16",
  "AWS Like-to-Like Instance": "m5.xlarge",
  ...extra,
});
const payload = {
  version: 1,
  sourcePage: "aws",
  providers: ["aws"],
  columnHeaders: ["VM Name", "App Name", "CPU Count", "Memory (GB)"],
  hasOptimized: false,
  hasLikeToLike: true,
  results: [
    row("spiky-1", "Storefront", { [P50]: "10", [PEAK]: "95" }),
    row("steady-1", "Storefront", { [P50]: "60", [PEAK]: "90" }),
    row("bare-1", "Storefront", {}),
    row("steady-2", "Billing", { [P50]: "55", [PEAK]: "85" }),
    row("nodata-1", "Reports", {}),
  ],
};
ctx.__payload = payload;
run("__m = buildPortfolioModel(__payload)");
const app = (name) => run(`__m.apps.find((a) => a.app === '${name}')`);
check(
  "Storefront: one candidate among two judged VMs; the VM without data is not counted as judged",
  app("Storefront").scaleOut.length === 1 &&
    app("Storefront").scaleOutEvaluated === 2,
  JSON.stringify([
    app("Storefront").scaleOut.length,
    app("Storefront").scaleOutEvaluated,
  ]),
);
run(
  "__sf = renderAppPanel(__m.apps.find((a) => a.app === 'Storefront'), __m, 0)",
);
const sf = run("__sf");
check(
  "the app panel names the candidate with its reason and frames it as guidance",
  /Scale-out candidates — 1\/2 judged/.test(sf) &&
    sf.includes("spiky-1") &&
    sf.includes("low p50 (10%), high Peak (95%)") &&
    sf.includes("Guidance, not an action") &&
    sf.includes("does not configure autoscaling"),
  sf.slice(0, 400),
);
run(
  "__rep = renderAppPanel(__m.apps.find((a) => a.app === 'Reports'), __m, 2)",
);
check(
  "an app whose VMs carry no median and peak shows no scale-out block at all",
  !run("__rep").includes("Scale-out"),
);
run(
  "__bil = renderAppPanel(__m.apps.find((a) => a.app === 'Billing'), __m, 1)",
);
check(
  "an app that was judged and has none says so, rather than staying silent",
  /Scale-out candidates — 0\/1 judged/.test(run("__bil")) &&
    run("__bil").includes("None of the VMs with a median and a peak"),
);
check(
  "the VM table carries an advisory column: reason, No, and blank for unjudged",
  /<th>Scale-out advisory<\/th>/.test(sf) &&
    sf.includes("<td>CPU: low p50 (10%), high Peak (95%)</td>") &&
    sf.includes("<td>No</td>") &&
    sf.includes("<td></td></tr>"),
);
const callouts = run("renderCallouts(__m)");
check(
  "the estate callout ranks apps by candidates, judged counts shown",
  callouts.includes("Scale-out candidates") &&
    /Storefront — <b>1<\/b> of 2 judged/.test(callouts),
  callouts,
);
ctx.__none = { ...payload, results: [row("a", "X", {}), row("b", "Y", {})] };
check(
  "an estate with nothing judged shows no callout",
  !run("renderCallouts(buildPortfolioModel(__none))").includes("Scale-out"),
);

process.exitCode = state.failures ? 1 : 0;
