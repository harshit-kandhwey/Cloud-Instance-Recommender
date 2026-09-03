// build-env suite: pins tools/lib/build-env.js — the generic Node/CI primitives
// (CLI flag reader, validated --date, the scratch-monolith path, atomic write) that
// every refresh/build tool depends on. No network.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeChecker } = require("../harness");
const {
  argValue,
  resolveDataDate,
  writeFileAtomic,
  monolithPath,
} = require("../../../tools/lib/build-env");

const { check, state } = makeChecker();

// ── argValue: CLI flag reader (argv injectable) ─────────────────────────────────
{
  const argv = ["node", "tool.js", "--provider", "aws", "--flag"];
  check(
    "argValue reads the value after a flag",
    argValue("--provider", argv) === "aws",
  );
  check(
    "argValue is undefined for an absent flag",
    argValue("--missing", argv) === undefined,
  );
  check(
    "argValue is undefined for a trailing flag with no value",
    argValue("--flag", argv) === undefined,
  );
}

// ── monolithPath: one definition of where the refresh's scratch monolith lives ───
// Five tools agree on this path by importing it. The directory matters as much as the
// name: .refresh-cache/ is gitignored, so the scratch artifact can never ride along in
// a refresh PR, and it is NOT under js/, so the shipped tree survives every step of
// the pipeline except split-data.
{
  const p = monolithPath("aws", "/root");
  check(
    "monolithPath puts the scratch monolith in .refresh-cache/, outside js/",
    p.replace(/\\/g, "/") === "/root/.refresh-cache/aws-monolith.js",
    p,
  );
  const ignored = fs
    .readFileSync(path.join(__dirname, "..", "..", "..", ".gitignore"), "utf8")
    .split(/\r?\n/)
    .some((l) => l.trim() === ".refresh-cache/");
  check("and .refresh-cache/ is gitignored, so it cannot reach a PR", ignored);
}

// ── resolveDataDate: the value that reaches the user-visible freshness badge ─────
{
  check(
    "resolveDataDate passes a real calendar date through",
    resolveDataDate("2026-08-30") === "2026-08-30",
  );
  check(
    "resolveDataDate defaults to today when the flag is absent",
    resolveDataDate(undefined, new Date("2026-08-30T11:22:33Z")) ===
      "2026-08-30",
  );

  // Guard (plant-RED: drop the validation and return the argument): --date is
  // serialized into {PREFIX}_DATA_DATE, which the page renders verbatim in the
  // "Instance data updated" badge — an unchecked value ships to users as-is.
  // 2026-02-30 is the case a format check alone misses: Date rolls it to 03-02.
  for (const bad of ["invalid", "2026-02-30", "2026-13-01", "2026-8-3", ""]) {
    let msg = "";
    try {
      resolveDataDate(bad);
    } catch (e) {
      msg = e.message;
    }
    check(
      `resolveDataDate rejects ${JSON.stringify(bad)}`,
      msg.includes(`invalid --date ${bad}`),
      msg || "(did not throw)",
    );
  }
}

// ── writeFileAtomic: a failed write never truncates what it replaces ────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cir-atomic-"));
  const target = path.join(dir, "artifact.js");

  writeFileAtomic(target, "window.X = 1;\n");
  check(
    "writeFileAtomic writes the contents and leaves no .tmp behind",
    fs.readFileSync(target, "utf8") === "window.X = 1;\n" &&
      !fs.existsSync(`${target}.tmp`),
    fs.readdirSync(dir).join(","),
  );

  // Guard (plant-RED: writeFileSync straight to the target): force the write to
  // fail by occupying the temp path with a directory. The previous artifact must
  // survive intact — a truncated monolith breaks readShippedRegionKeys on the next
  // run, which is the failure this replaced.
  fs.mkdirSync(`${target}.tmp`);
  let threw = false;
  try {
    writeFileAtomic(target, "window.X = 2;\n");
  } catch {
    threw = true;
  }
  check(
    "a failed writeFileAtomic throws and leaves the previous artifact intact",
    threw && fs.readFileSync(target, "utf8") === "window.X = 1;\n",
    fs.readFileSync(target, "utf8"),
  );

  fs.rmSync(dir, { recursive: true, force: true });
}

// ── The refresh pipeline writes its artifacts through that helper, not raw ───────
// Structural: every tool in the pipeline writes a durable artifact another step or
// the shipped page then reads, so a torn or truncated file from any one of them has
// the same cost. Pinned as a set because the guard that matters is the one nobody
// remembers to copy into the next tool.
{
  const pipeline = [
    "fetch-official-aws.js",
    "fetch-official-azure.js",
    "fetch-official-gcp.js",
    "fetch-vantage.js",
    "reconcile-data.js",
    "recommendation-diff.js",
    "split-data.js",
    "refresh-local.js",
  ];
  const raw = pipeline.filter((f) =>
    fs
      .readFileSync(path.join(__dirname, "..", "..", "..", "tools", f), "utf8")
      .includes("fs.writeFileSync("),
  );
  check(
    "no refresh tool writes an artifact with a raw fs.writeFileSync",
    raw.length === 0,
    raw.join(",") || "none",
  );
}

if (state.failures) {
  console.error(`\nbuild-env: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nbuild-env: all checks passed");
  process.exitCode = 0;
}
