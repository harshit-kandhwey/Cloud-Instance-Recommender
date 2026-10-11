// portfolio-copy-expiry suite: the App Portfolio's localStorage copy of the last
// results is a convenience for reloads and cold opens, and it holds the uploaded
// columns. It used to stay until the user cleared storage. A copy older than a day, or
// whose date cannot be read, is now removed instead of shown; the postMessage hand-off
// is a live delivery and is never expired.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { REPO, makeChecker } = require("../harness");
const { check, state } = makeChecker();

const store = new Map();
const fakeEl = (id) => ({
  id,
  innerHTML: "",
  classList: { add() {}, remove() {}, contains: () => false },
});
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  },
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
for (const rel of [
  "src/shared/storage-keys.js",
  "src/shared/app-core.js",
  "src/features/portfolio.js",
]) {
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
}
const run = (expr) => vm.runInContext(expr, ctx);
const KEY = run("PORTFOLIO_STORAGE_KEY");

const HOUR = 3600 * 1000;
const rows = [
  {
    "VM Name": "a",
    "App Name": "A",
    "CPU Count": "2",
    "Memory (GB)": "4",
    "AWS Like-to-Like Instance": "m5.large",
  },
];
const payloadAt = (generatedAt) => ({
  version: 1,
  generatedAt,
  providers: ["aws"],
  results: rows,
});
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

// Writes the copy, clears the receiver, runs the cold-open read, reports what happened.
function coldOpen(payload) {
  store.clear();
  store.set(
    KEY,
    typeof payload === "string" ? payload : JSON.stringify(payload),
  );
  run("portfolioData = null; portfolioModel = null;");
  run("loadPortfolioFromStorage()");
  return { shown: run("portfolioData") !== null, kept: store.has(KEY) };
}

{
  const r = coldOpen(payloadAt(iso(-60 * 1000)));
  check("a copy a minute old is shown and kept", r.shown && r.kept);
}
{
  const r = coldOpen(payloadAt(iso(-23 * HOUR)));
  check("a copy 23 hours old is still shown", r.shown && r.kept);
}
{
  const r = coldOpen(payloadAt(iso(-25 * HOUR)));
  check(
    "a copy 25 hours old is not shown and is removed",
    !r.shown && !r.kept,
    JSON.stringify(r),
  );
}
{
  const r = coldOpen({ version: 1, providers: ["aws"], results: rows });
  check(
    "a copy with no date (written by an earlier build) is not shown and is removed",
    !r.shown && !r.kept,
    JSON.stringify(r),
  );
}
{
  const a = coldOpen(payloadAt("last tuesday"));
  const b = coldOpen(payloadAt(1760000000000));
  check(
    "a date that is not an ISO string is not shown and is removed",
    !a.shown && !a.kept && !b.shown && !b.kept,
    JSON.stringify([a, b]),
  );
}
{
  const r = coldOpen(payloadAt(iso(24 * HOUR)));
  check(
    "a copy dated a day in the future is not shown and is removed",
    !r.shown && !r.kept,
    JSON.stringify(r),
  );
}
{
  const r = coldOpen(payloadAt(iso(60 * 1000)));
  check("a minute of clock skew is tolerated", r.shown && r.kept);
}
{
  const r = coldOpen("{not json");
  check(
    "an unreadable copy does not throw and is not shown",
    !r.shown,
    JSON.stringify(r),
  );
}

// the boundary, deterministically
{
  const at = Date.parse("2026-10-11T00:00:00.000Z");
  const p = { generatedAt: new Date(at).toISOString() };
  const fresh = (offset) =>
    run(`portfolioCopyIsFresh(${JSON.stringify(p)}, ${at + offset})`);
  check("exactly one day old is fresh", fresh(24 * HOUR) === true);
  check("one millisecond past a day is not", fresh(24 * HOUR + 1) === false);
  check("five minutes ahead is fresh", fresh(-5 * 60 * 1000) === true);
  check(
    "five minutes and a millisecond ahead is not",
    fresh(-5 * 60 * 1000 - 1) === false,
  );
}

// a live postMessage delivery is not subject to the copy's age
{
  store.clear();
  run("portfolioData = null; portfolioModel = null;");
  vm.runInContext(
    `receivePortfolio(${JSON.stringify(payloadAt(iso(-72 * HOUR)))})`,
    ctx,
  );
  check(
    "a payload delivered by postMessage is shown whatever its date",
    run("portfolioData") !== null,
  );
}

if (state.failures) {
  console.error(`\nportfolio-copy-expiry: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nportfolio-copy-expiry: all checks passed");
  process.exitCode = 0;
}
