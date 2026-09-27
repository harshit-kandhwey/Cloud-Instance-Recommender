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

// A tag is a moving pointer: whoever controls the action's repo can re-point v7 at
// different code, and every job that names it runs that code with this repo's
// token. A full commit SHA cannot move; the trailing comment keeps it readable.
for (const file of ["ci.yml", "data-refresh.yml"]) {
  const src = fs
    .readFileSync(path.join(REPO, ".github", "workflows", file), "utf8")
    .split("\r\n")
    .join("\n");
  // Any spacing after the sequence dash is valid YAML, the key may be quoted
  // ("uses":), and a value may be quoted too.
  const uses = [...src.matchAll(/^\s*(?:-\s+)?["']?uses["']?:\s*(.+)$/gm)].map(
    (m) => m[1].replace(/^(["'])(.*?)\1/, "$2"),
  );
  check(
    `${file}: the scan found its action references`,
    uses.length > 0,
    `found ${uses.length}`,
  );
  // A line the extractor cannot read would otherwise vanish from the pin check
  // below while the others keep it green. Same quoted-key allowance as above —
  // otherwise this cross-check shares the extractor's own blind spot and can
  // never catch it.
  const mentioned = (src.match(/^[^#\n]*\buses["']?:/gm) || []).length;
  check(
    `${file}: no uses: line escapes the scan`,
    mentioned === uses.length,
    `${mentioned} uses: line(s), ${uses.length} read`,
  );
  // A local action or a docker:// image has no commit to pin.
  const unpinned = uses.filter(
    (u) =>
      !/^(\.\/|docker:\/\/)/.test(u) &&
      !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # \S+$/.test(u),
  );
  check(
    `${file}: every action is pinned to a full commit SHA with a version comment`,
    unpinned.length === 0,
    unpinned.join("; "),
  );
}

if (state.failures) {
  console.error(`\nworkflow-hardening: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nworkflow-hardening: all checks passed");
  process.exitCode = 0;
}
