// Runs every suite in tests/suites/ plus the golden byte-compare.
// Plain Node, no framework: node tests/run-all.js
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const suitesDir = path.join(__dirname, "suites");
const repoRoot = path.join(__dirname, "..");
const failed = [];

console.log("── Test suites ────────────────────────────────────────────");
// Suites live one level deep now, grouped by feature area (ingest/, engine/,
// …). Recurse so every *-test.js is found wherever it sits; the label keeps the
// folder so a failure line points at the right area.
function findSuites(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findSuites(full, out);
    else if (entry.name.endsWith("-test.js")) out.push(full);
  }
  return out;
}
const suites = findSuites(suitesDir)
  .map((f) => path.relative(suitesDir, f).split(path.sep).join("/"))
  .sort();

// Smoke tier: `node tests/run-all.js --smoke` (npm run test:smoke) runs only the
// critical-path subset named in tests/smoke.json — a fast local sanity pass over
// load → ingest → generate → export. The full suite is unchanged and still runs
// in CI on every PR and main; this tier is a developer convenience, not a CI
// gate. The golden compare always runs (it *is* the generate→export path).
//
// A manifest entry that names no discovered suite is a hard error, never a
// silent skip — a smoke run that quietly drops a suite it was meant to cover is
// the exact broken-guard failure the rest of this test work exists to prevent.
let activeSuites = suites;
if (process.argv.includes("--smoke")) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "smoke.json"), "utf8"),
  );
  const wanted = manifest.suites;
  // An empty or missing suites list is the same broken-guard failure this file's
  // header warns about: it would run zero suites and still report success. A
  // smoke manifest that names nothing is a manifest bug, not a valid "skip all".
  if (!Array.isArray(wanted) || wanted.length === 0) {
    console.error("smoke.json must contain a non-empty suites array");
    process.exit(2);
  }
  const known = new Set(suites);
  const missing = wanted.filter((s) => !known.has(s));
  if (missing.length) {
    console.error(
      `smoke.json lists ${missing.length} suite(s) that no longer exist: ${missing.join(", ")}`,
    );
    process.exit(2);
  }
  const want = new Set(wanted);
  activeSuites = suites.filter((s) => want.has(s));
  console.log(
    `Smoke tier — ${activeSuites.length} of ${suites.length} suites + goldens\n`,
  );
}

for (const suite of activeSuites) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(suitesDir, suite)], {
    encoding: "utf8",
    timeout: 120000,
  });
  const ok = result.status === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${suite}  (${Date.now() - started}ms)`);
  if (!ok) {
    failed.push(suite);
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
  }
}

console.log("── Golden outputs ─────────────────────────────────────────");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cir-golden-"));
const golden = spawnSync(
  process.execPath,
  [
    "--max-old-space-size=4096",
    path.join(__dirname, "golden", "golden-run.js"),
    repoRoot,
    outDir,
  ],
  { encoding: "utf8", timeout: 300000 },
);
if (golden.status !== 0) {
  failed.push("golden-run");
  process.stdout.write(golden.stdout || "");
  process.stderr.write(golden.stderr || "");
} else {
  const goldensDir = path.join(__dirname, "golden", "goldens");
  for (const file of fs.readdirSync(goldensDir)) {
    const expected = fs.readFileSync(path.join(goldensDir, file), "utf8");
    const actualPath = path.join(outDir, file);
    const actual = fs.existsSync(actualPath)
      ? fs.readFileSync(actualPath, "utf8")
      : null;
    // Compare content, not checkout line-ending style
    const same =
      actual !== null &&
      actual.replace(/\r\n/g, "\n") === expected.replace(/\r\n/g, "\n");
    console.log(`${same ? "PASS" : "FAIL"}  golden ${file}`);
    if (!same) failed.push(`golden ${file}`);
  }
}

console.log("───────────────────────────────────────────────────────────");
if (failed.length) {
  console.error(`${failed.length} failure(s): ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`All ${activeSuites.length} suites + goldens passed.`);
