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
for (const suite of suites) {
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
console.log(`All ${suites.length} suites + goldens passed.`);
