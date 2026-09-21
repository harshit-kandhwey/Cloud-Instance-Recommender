// workflow-hardening suite: pins the CI workflow's least-privilege and
// bounded-runtime settings. Without an explicit `permissions:` block the
// GITHUB_TOKEN scope falls back to the repo/org default, which can be write; a
// job without `timeout-minutes` can hang for GitHub's 6-hour ceiling.
//
// Scoped to ci.yml: data-refresh.yml legitimately needs contents/pull-requests
// write and declares it.
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const text = fs
  .readFileSync(path.join(REPO, ".github", "workflows", "ci.yml"), "utf8")
  .split("\r\n")
  .join("\n");
const [preamble, jobsBlock] = text.split(/^jobs:\n/m);

check(
  "ci.yml declares a top-level permissions block",
  /^permissions:\n {2}contents: read\n/m.test(preamble),
);

// A job is a two-space-indented key directly under `jobs:`.
const jobs = jobsBlock.split(/^ {2}(?=[a-z0-9-]+:\n)/m).filter(Boolean);
check(
  "the scan found the CI jobs (guards against a broken split)",
  jobs.length >= 6,
  `found ${jobs.length}`,
);

const unbounded = jobs
  .filter((j) => !/^ {4}timeout-minutes: \d+$/m.test(j))
  .map((j) => j.split(":")[0]);
check(
  "every ci.yml job sets timeout-minutes",
  unbounded.length === 0,
  unbounded.join(", "),
);

if (state.failures) {
  console.error(`\nworkflow-hardening: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nworkflow-hardening: all checks passed");
  process.exitCode = 0;
}
