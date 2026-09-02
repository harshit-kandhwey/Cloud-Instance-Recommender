// docs-currency suite: pins the two contributor-facing docs against the repo they
// describe. 3.14 added eight build tools, tools/lib/, and docs/DATA-SOURCES.md while
// README and CONTRIBUTING still listed a single tool under a CLOSING branch and still
// taught the pre-3.14 hand-edit refresh. Stale instructions that read as complete are
// the hazard here — a contributor follows them and hand-edits generated data — so the
// listing, the pipeline order, and the provenance link are all pinned.
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");
const { planSteps } = require("../../../tools/refresh-local");

const { check, state } = makeChecker();

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

// `fetch-official-{aws,azure,gcp}.js` in a doc stands for three real files; expand the
// shorthand so the docs are compared against actual file names, not against prose.
const expandBraces = (text) =>
  text.replace(/([\w.-]*)\{([^{}]+)\}([\w.-]*)/g, (_m, pre, list, post) =>
    list
      .split(",")
      .map((v) => `${pre}${v.trim()}${post}`)
      .join(" "),
  );

// The tools/ block of a doc's project tree: the tools/ entry through to the next
// top-level branch. Scoped to the block, not the file: these names also appear in the
// surrounding prose, and a passing mention is not a listing.
const toolsBlock = (rel) => {
  const lines = read(rel).split("\n");
  const start = lines.findIndex((l) => /^[├└]── tools\//.test(l));
  if (start === -1) return "";
  const end = lines.findIndex((l, i) => i > start && /^[├└]── /.test(l));
  return expandBraces(
    lines.slice(start, end === -1 ? lines.length : end).join("\n"),
  );
};

// A doc section, heading to next heading of the same level.
const section = (rel, heading) => {
  const text = read(rel);
  const start = text.indexOf(heading);
  if (start === -1) return "";
  const end = text.indexOf("\n## ", start + heading.length);
  return text.slice(start, end === -1 ? text.length : end);
};

// The arrow chain itself — a run of backticked names joined by arrows — not the
// paragraph around it. The same step names recur in the prose that explains WHY the
// order holds, so reading the paragraph would pass on a chain missing a step.
const arrowChain = (text) =>
  expandBraces((text.match(/`[\w{},.-]+`(?:\s*→\s*`[\w{},.-]+`)+/) || [""])[0]);

const shipped = [
  ...fs.readdirSync(path.join(REPO, "tools")).filter((f) => f.endsWith(".js")),
  ...fs
    .readdirSync(path.join(REPO, "tools", "lib"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `lib/${f}`),
];

// ── The project trees list every build tool, and only tools that exist ──────────
{
  check(
    "tools/ holds more than the one tool the trees used to list",
    shipped.length > 1,
    shipped.join(","),
  );

  for (const rel of ["README.md", "CONTRIBUTING.md"]) {
    const block = toolsBlock(rel);
    const missing = shipped.filter((f) => !block.includes(f));
    check(
      `${rel} lists every file in tools/`,
      block !== "" && missing.length === 0,
      block === "" ? "no tools/ block found" : missing.join(",") || "complete",
    );

    // The other direction: a tool the tree still names after it was deleted sends a
    // contributor looking for a file that is not there.
    const named = block.match(/[\w./-]+\.js/g) || [];
    const ghosts = named.filter(
      (n) => !fs.existsSync(path.join(REPO, "tools", n)),
    );
    check(
      `${rel} names no tool that no longer exists`,
      ghosts.length === 0,
      ghosts.join(",") || "none",
    );
  }
}

// ── The refresh runbook matches the pipeline it documents ───────────────────────
{
  const refresh = section("CONTRIBUTING.md", "## Updating Instance Data");
  check(
    "CONTRIBUTING has an Updating Instance Data section",
    refresh !== "",
    refresh === "" ? "section missing" : `${refresh.length} chars`,
  );

  // Guard (plant-RED: drop a step from the doc, or reorder two): the order is
  // load-bearing — the official fetchers read the manifest fetch-vantage overwrites,
  // and split-data rewrites the regions/ both diffs read as the old side.
  const chain = arrowChain(refresh);
  const steps = planSteps({ pricing: true, date: "x" }).map((s) => s.name);
  const at = steps.map((n) => chain.indexOf(n));
  check(
    "CONTRIBUTING states the whole pipeline, in planSteps order",
    chain !== "" && at.every((i, k) => i !== -1 && (k === 0 || i > at[k - 1])),
    chain || "no order chain found",
  );

  // Guard (plant-RED: restore the pre-3.14 hand-edit steps): the runbook must send a
  // contributor through the tool and land the result via review, never a direct push.
  check(
    "CONTRIBUTING refreshes through npm run refresh and lands it via a pull request",
    refresh.includes("npm run refresh") && /pull request/i.test(refresh),
    refresh.includes("npm run refresh") ? "no PR rule" : "no npm run refresh",
  );
}

// ── The provenance doc is reachable, and every doc link resolves ────────────────
{
  check(
    "README links docs/DATA-SOURCES.md",
    read("README.md").includes("(docs/DATA-SOURCES.md)"),
  );

  for (const rel of ["README.md", "CONTRIBUTING.md"]) {
    // In-repo targets only: `../../discussions` and friends are GitHub-relative and
    // resolve above the repo root, where there is nothing to check.
    const links = [...read(rel).matchAll(/\]\(([^)#:\s]+)\)/g)]
      .map((m) => m[1])
      .filter((l) => !l.startsWith(".."));
    const broken = links.filter((l) => !fs.existsSync(path.join(REPO, l)));
    check(
      `${rel} has no broken relative link`,
      broken.length === 0,
      broken.join(",") || `${links.length} links resolve`,
    );
  }
}

// ── Every tools/ path a doc names must exist ───────────────────────────────────
// .env.example told the reader GCP_BILLING_API_KEY was "used by
// tools/fetch-pricing-gcp.js", a file that has never existed — the real consumer is
// fetch-official-gcp.js, which in turn points back at .env.example. Prose naming a
// path is the one kind of doc claim that can be checked mechanically, so check it
// everywhere rather than only where it was found wrong.
{
  for (const rel of [".env.example", "README.md", "CONTRIBUTING.md"]) {
    const named = [...read(rel).matchAll(/\btools\/[\w.-]+\.js\b/g)].map(
      (m) => m[0],
    );
    const missing = [
      ...new Set(named.filter((p) => !fs.existsSync(path.join(REPO, p)))),
    ];
    check(
      `${rel} names no tools/ file that does not exist`,
      missing.length === 0,
      missing.join(",") || `${new Set(named).size} tool paths resolve`,
    );
  }
}

// ── tests/README.md's gate table matches the CI it describes ───────────────────
// Testing instructions used to be split across CONTRIBUTING (two commands) and
// this file's subject docs, so a contributor could follow CONTRIBUTING exactly,
// run one of the eight gate commands, and still fail CI. 3.15 collapsed all of it
// into tests/README.md — which only helps for as long as that one copy stays
// true, and nothing pinned it. So pin it: a CI job nobody documented, or a table
// row naming a command that no longer exists, both fail here.
{
  const gates = section("tests/README.md", "## The gates");
  check(
    "tests/README.md has a gate table",
    gates.includes("| Command") && gates.split("\n").length > 6,
    gates === "" ? "section missing" : `${gates.split("\n").length} lines`,
  );

  // Top-level keys under `jobs:` — two-space indent, which nothing nested reaches.
  const ci = read(".github/workflows/ci.yml");
  const jobNames = [
    ...ci.slice(ci.indexOf("\njobs:")).matchAll(/^ {2}([a-z][\w-]*):$/gm),
  ].map((m) => m[1]);
  check(
    "the CI workflow declares jobs this check can read",
    jobNames.length >= 5,
    jobNames.join(",") || "none parsed",
  );
  const undocumented = jobNames.filter((j) => !gates.includes(`\`${j}\``));
  check(
    "every CI job appears in the gate table",
    undocumented.length === 0,
    undocumented.length
      ? `${undocumented.join(",")} — add a row to tests/README.md`
      : `${jobNames.length} jobs documented`,
  );

  // The other direction: a row promising a command that does not exist sends a
  // contributor to a broken shell line. Resolve `npm run X` against package.json
  // and `node path/to.js` against the filesystem.
  const scripts = JSON.parse(read("package.json")).scripts || {};
  const npmRuns = [...gates.matchAll(/`npm run ([\w:]+)`/g)].map((m) => m[1]);
  const nodeRuns = [...gates.matchAll(/`node ([\w./-]+\.js)/g)].map(
    (m) => m[1],
  );
  check(
    "the gate table names commands to resolve",
    npmRuns.length + nodeRuns.length >= 6,
    `${npmRuns.length} npm + ${nodeRuns.length} node`,
  );
  const deadScripts = npmRuns.filter((s) => !(s in scripts));
  const deadPaths = nodeRuns.filter((p) => !fs.existsSync(path.join(REPO, p)));
  check(
    "every command in the gate table resolves",
    deadScripts.length === 0 && deadPaths.length === 0,
    [...deadScripts.map((s) => `npm run ${s}`), ...deadPaths].join(",") ||
      `${npmRuns.length + nodeRuns.length} commands resolve`,
  );
}

if (state.failures) {
  console.error(`\ndocs-currency: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\ndocs-currency: all checks passed");
  process.exitCode = 0;
}
