// workflow-hardening suite: pins the CI workflow's least-privilege and
// bounded-runtime settings. Without an explicit `permissions:` block the
// GITHUB_TOKEN scope falls back to the repo/org default, which can be write; a
// job without `timeout-minutes` can hang for GitHub's 6-hour ceiling.
//
// The first checks are scoped to ci.yml; data-refresh.yml has its own block below.
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

// ── data-refresh.yml: no write credential reaches a step that evaluates feed data ──
// The workflow fetches vendor data, evaluates it (the monolith is run through vm), and
// opens a pull request. A write-scoped token, or a PAT persisted by checkout into
// .git/config, would give every later step a credential that could push, so the token
// is read-only everywhere and the PAT is attached to the remote in the final step only.
{
  const src = fs
    .readFileSync(
      path.join(REPO, ".github", "workflows", "data-refresh.yml"),
      "utf8",
    )
    .split("\r\n")
    .join("\n");
  const code = src
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  const top = code.match(/^permissions:\n((?: {2}[a-z-]+: \w+\n)+)/m);
  check("data-refresh.yml declares a top-level permissions block", !!top);
  check(
    "its top-level token is read-only: contents: read and nothing else",
    !!top && top[1] === "  contents: read\n",
    top ? top[1] : "none",
  );
  check(
    "no job asks for write scope",
    !/^\s+[a-z-]+: write$/m.test(code),
    (code.match(/^\s+[a-z-]+: write$/gm) || []).join(", "),
  );

  const checkouts = [
    ...code.matchAll(/uses: actions\/checkout@[^\n]+\n((?: {8,}[^\n]+\n)*)/g),
  ];
  check(
    "the scan found the checkout steps",
    checkouts.length >= 2,
    String(checkouts.length),
  );
  check(
    "every checkout leaves no credential behind",
    checkouts.every((m) => /^ {10}persist-credentials: false$/m.test(m[1])),
    checkouts.map((m) => m[1].trim().replace(/\n\s*/g, " ; ")).join(" | "),
  );
  check(
    "no checkout is given a token",
    checkouts.every((m) => !/^ {10}token:/m.test(m[1])),
  );

  const uses = code.split("DATA_REFRESH_PAT").length - 1;
  check(
    "the PAT is named exactly once in the workflow",
    uses === 1,
    `${uses} references`,
  );
  const stepStart = code.lastIndexOf("      - name: Open refresh PR");
  const patAt = code.indexOf("DATA_REFRESH_PAT");
  const nextStep = code.indexOf("\n      - ", stepStart + 1);
  check(
    "and that one reference is inside the Open refresh PR step",
    stepStart >= 0 &&
      patAt > stepStart &&
      (nextStep === -1 || patAt < nextStep),
    `step at ${stepStart}, PAT at ${patAt}`,
  );
  const pushAt = code.indexOf('git push origin "$branch"');
  const setUrlAt = code.indexOf("git remote set-url origin");
  check(
    "the PAT is attached to the remote before the push, in that step",
    setUrlAt > stepStart && pushAt > setUrlAt,
    `set-url ${setUrlAt}, push ${pushAt}`,
  );
  check(
    "the Open refresh PR step is the last step of its job",
    stepStart >= 0 && nextStep === -1,
    `next step at ${nextStep}`,
  );
}

if (state.failures) {
  console.error(`\nworkflow-hardening: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nworkflow-hardening: all checks passed");
  process.exitCode = 0;
}
