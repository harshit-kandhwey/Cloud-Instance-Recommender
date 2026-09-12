// docs-currency suite: pins the two contributor-facing docs against the repo they
// describe. 3.14 added eight build tools, scripts/lib/, and docs/data/DATA-SOURCES.md
// while README and CONTRIBUTING still listed a single tool under a CLOSING branch and
// still taught the pre-3.14 hand-edit refresh. Stale instructions that read as complete
// are the hazard here — a contributor follows them and hand-edits generated data — so
// the listing, the pipeline order, and the provenance link are all pinned.
// `tools/` was renamed to `scripts/{data,testing,lib}/` — three sibling
// subdirectories, none of them an implicit default the way flat `tools/`'s direct
// children were — so each is its own block, checked with the same indent-aware
// algorithm as js/base/'s block below (generalised into `treeBlock`).
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");
const { planSteps } = require("../../../scripts/data/refresh-local");

const { check, state } = makeChecker();

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

// An npm script name's underlying command text, so an `npm run X` reference and the
// `node ...` line it ultimately runs can be recognised as the SAME gate.
const scriptText = (scripts, name) => (scripts[name] || "").trim();

// `fetch-official-{aws,azure,gcp}.js` in a doc stands for three real files; expand the
// shorthand so the docs are compared against actual file names, not against prose.
const expandBraces = (text) =>
  text.replace(/([\w.-]*)\{([^{}]+)\}([\w.-]*)/g, (_m, pre, list, post) =>
    list
      .split(",")
      .map((v) => `${pre}${v.trim()}${post}`)
      .join(" "),
  );

// A NAMED entry's block in a doc's project tree — the `${name}/` line through to
// the next SAME-INDENT tree entry, not the first line starting with the indent
// prefix at all (a child line, e.g. `│   ├── charts.js`, starts one level deeper
// than the bare indent the entry itself sits at, so it does not end the block
// early). Scoped to the block, not the file: these names also appear in the
// surrounding prose, and a passing mention is not a listing. The entry line may
// carry a trailing comment, so the match stops at the entry name, not end-of-line.
// Generalises what were two near-identical functions (tools/'s block finder and
// js/base/'s) into one, now that `scripts/` and `docs/` each have several
// same-named children across the two trees (both have a `data/`) — `fromLine`
// scopes the search to start after a specific line, so `treeBlock(rel, "data",
// scriptsStart)` cannot match `docs/`'s `data/` entry instead of `scripts/`'s.
// Indent can carry a `│` continuation column (a non-last parent, e.g. `scripts/`
// with `tests/`+`js/` still to come) as well as plain spaces (a last parent,
// e.g. `js/`'s own children) — `\s` alone doesn't match `│`, so both are
// captured explicitly.
const treeBlock = (rel, name, fromLine = 0) => {
  const lines = read(rel).split("\n");
  const start = lines.findIndex(
    (l, i) =>
      i >= fromLine && new RegExp(`^([\\s│]*)[├└]── ${name}/(\\s|$)`).test(l),
  );
  if (start === -1) return "";
  const indent = lines[start].match(/^([\s│]*)/)[1];
  // Ends at the next tree-branch line at this SAME OR SHALLOWER indent — a
  // sibling of this block, or a sibling of one of its ancestors. A same-indent
  // sibling is the common case (`data/` ending at `testing/`); shallower is
  // needed for a block with no more siblings of its own (`lib/`, scripts/'s
  // LAST child) — without either, "no next same-indent line, no closing fence"
  // falls through to end-of-file and swallows the rest of the document. The
  // closing fence matters when the block being extracted is the LAST thing in
  // the tree diagram (`src/`'s own last child, `shared/`) — there is no next
  // tree line of any indent to stop at, only the ``` that ends the code block.
  const end = lines.findIndex((l, i) => {
    if (i <= start) return false;
    if (/^```/.test(l)) return true;
    const m = l.match(/^([\s│]*)[├└]── /);
    return m !== null && m[1].length <= indent.length;
  });
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

// scripts/'s three sibling subdirectories, each checked as its own block —
// none of the three is an implicit default the way tools/'s direct children
// were under flat tools/, so there is no single combined "shipped" list anymore.
const SCRIPT_DIRS = ["data", "testing", "lib"];
const shippedByDir = Object.fromEntries(
  SCRIPT_DIRS.map((d) => [
    d,
    fs
      .readdirSync(path.join(REPO, "scripts", d))
      .filter((f) => f.endsWith(".js")),
  ]),
);

// ── The project trees list every build script, and only scripts that exist ──────
{
  const allShipped = SCRIPT_DIRS.flatMap((d) => shippedByDir[d]);
  check(
    "scripts/ holds more than the one tool the trees used to list",
    allShipped.length > 1,
    allShipped.join(","),
  );

  for (const rel of ["README.md", ".github/CONTRIBUTING.md"]) {
    // Scope each data/testing/lib search to start after the top-level `scripts/`
    // line, so it can't match `docs/`'s own `data/` entry instead.
    const scriptsLine = read(rel)
      .split("\n")
      .findIndex((l) => /^[├└]── scripts\/(\s|$)/.test(l));
    for (const dir of SCRIPT_DIRS) {
      const block = treeBlock(rel, dir, scriptsLine + 1);
      const shipped = shippedByDir[dir];
      const missing = shipped.filter((f) => !block.includes(f));
      check(
        `${rel} lists every file in scripts/${dir}/`,
        block !== "" && missing.length === 0,
        block === ""
          ? `no scripts/${dir}/ block found`
          : missing.join(",") || "complete",
      );

      // The other direction: a script the tree still names after it was deleted
      // sends a contributor looking for a file that is not there.
      const named = block.match(/[\w./-]+\.js/g) || [];
      const ghosts = named.filter(
        (n) => !fs.existsSync(path.join(REPO, "scripts", dir, n)),
      );
      check(
        `${rel} names no scripts/${dir}/ file that no longer exists`,
        ghosts.length === 0,
        ghosts.join(",") || "none",
      );
    }
  }
}

// ── README's project tree lists every src/{core,features,ui,shared} module ─────
// js/base/ (the pre-3.16-tail location) had no test suite folder of its own to
// piggyback coverage claims on (unlike scripts/, which coverage:check walks
// separately) — nothing else in this repo would notice a module added here and
// never named in the tree. That is exactly what happened once: charts.js,
// user-rules.js and user-rules-ui.js shipped, were tested, were wired into
// every page, and were absent from the tree with no check anywhere to say so.
// The 3.16 tail split js/base/ into core/{engine,rules}, features/, ui/ and
// shared/ — checked here by bare filename against the WHOLE src/ block rather
// than per-subdirectory (unlike scripts/'s stricter per-block check): every
// filename in this set is unique, so this still catches an added-and-
// undocumented or removed-but-still-named module, without needing five
// separate nested-block extractions for what was one flat directory before.
{
  const SRC_MODULE_DIRS = [
    ["core", "engine"],
    ["core", "rules"],
    ["features"],
    ["ui"],
    ["shared"],
  ];
  const shippedBase = SRC_MODULE_DIRS.flatMap((parts) =>
    fs
      .readdirSync(path.join(REPO, "src", ...parts))
      .filter((f) => f.endsWith(".js")),
  );
  check(
    "src/{core,features,ui,shared} holds more than the tree's first few entries",
    shippedBase.length > 5,
    shippedBase.join(","),
  );

  for (const rel of ["README.md", ".github/CONTRIBUTING.md"]) {
    const block = treeBlock(rel, "src");
    const missing = shippedBase.filter((f) => !block.includes(f));
    check(
      `${rel} lists every module in src/{core,features,ui,shared}`,
      block !== "" && missing.length === 0,
      block === "" ? "no src/ block found" : missing.join(",") || "complete",
    );

    // The other direction: a module the tree still names after it was deleted or
    // renamed sends a contributor looking for a file that is not there. Checked
    // against the whole SRC_MODULE_DIRS set (providers/ has its own, much larger
    // per-provider file set and is not part of this claim).
    const named = block.match(/[\w./-]+\.js/g) || [];
    const existsSomewhere = (n) =>
      SRC_MODULE_DIRS.some((parts) =>
        fs.existsSync(path.join(REPO, "src", ...parts, n)),
      ) ||
      ["aws", "azure", "gcp"].some((p) =>
        fs.existsSync(path.join(REPO, "src", "providers", p, n)),
      );
    const ghosts = named.filter(
      (n) => n.includes("/") === false && !existsSomewhere(n),
    );
    check(
      `${rel} names no src/ module that no longer exists`,
      ghosts.length === 0,
      ghosts.join(",") || "none",
    );
  }
}

// ── The refresh runbook matches the pipeline it documents ───────────────────────
{
  const refresh = section(
    ".github/CONTRIBUTING.md",
    "## Updating Instance Data",
  );
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
    "README links docs/data/DATA-SOURCES.md",
    read("README.md").includes("(docs/data/DATA-SOURCES.md)"),
  );

  for (const rel of ["README.md", ".github/CONTRIBUTING.md"]) {
    // In-repo targets only: `../../../discussions` and friends are GitHub-relative
    // and resolve above the repo root, where there is nothing to check.
    const links = [...read(rel).matchAll(/\]\(([^)#:\s]+)\)/g)]
      .map((m) => m[1])
      .filter((l) => !l.startsWith(".."));
    // Resolve against the FILE's own directory, not the repo root — a same-dir
    // sibling link (CONTRIBUTING.md -> SECURITY.md, both now under .github/) is
    // only correct relative to where the linking file actually sits.
    const fileDir = path.dirname(path.join(REPO, rel));
    const broken = links.filter((l) => !fs.existsSync(path.join(fileDir, l)));
    check(
      `${rel} has no broken relative link`,
      broken.length === 0,
      broken.join(",") || `${links.length} links resolve`,
    );
  }
}

// ── Every scripts/ path a doc names must exist ─────────────────────────────────
// .env.example once told the reader GCP_BILLING_API_KEY was "used by
// tools/fetch-pricing-gcp.js", a file that had never existed — the real consumer
// was fetch-official-gcp.js, which in turn pointed back at .env.example. Prose
// naming a path is the one kind of doc claim that can be checked mechanically,
// so check it everywhere rather than only where it was found wrong. The pattern
// allows one extra path segment (`[\w./-]+` not `[\w.-]+`) now that scripts/
// nests three levels deep (scripts/data/fetch-official-gcp.js), unlike flat
// tools/.
{
  for (const rel of [".env.example", "README.md", ".github/CONTRIBUTING.md"]) {
    const named = [...read(rel).matchAll(/\bscripts\/[\w./-]+\.js\b/g)].map(
      (m) => m[0],
    );
    const missing = [
      ...new Set(named.filter((p) => !fs.existsSync(path.join(REPO, p)))),
    ];
    check(
      `${rel} names no scripts/ file that does not exist`,
      missing.length === 0,
      missing.join(",") || `${new Set(named).size} script paths resolve`,
    );
  }
}

// ── No doc still names the retired tools/ prefix ─────────────────────────────
// The check above only recognises scripts/... paths, so it silently passes a
// doc that still says tools/fetch-vantage.js — a real gap a CodeRabbit review
// caught: docs/data/DATA-SOURCES.md kept 3 tools/-prefixed mentions after the
// scripts/ rename with nothing here to flag it. tools/ is fully retired (no
// path under it exists at all any more), so any literal tools/<name> mention
// is stale by definition — check every doc that has ever named a tool by path.
{
  for (const rel of [
    ".env.example",
    "README.md",
    ".github/CONTRIBUTING.md",
    "docs/data/DATA-SOURCES.md",
    "docs/data/CANONICAL-SOURCES.md",
    "docs/operations/RELEASING.md",
  ]) {
    const stale = [...read(rel).matchAll(/\btools\/[\w./-]+\b/g)].map(
      (m) => m[0],
    );
    check(
      `${rel} names no retired tools/ path`,
      stale.length === 0,
      [...new Set(stale)].join(",") || "none",
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
  // Compare against the gate table's JOB COLUMN, not the whole section. A bare
  // `gates.includes` passes on any backticked mention anywhere in the prose, so a
  // row deleted from the table while its name survives in a sentence would leave
  // this check green while the table no longer documents the job.
  // The job is the LAST column; the first backticked cell is the command, so a
  // regex anchored to the row start reads the wrong one.
  const gateJobs = new Set(
    gates
      .split("\n")
      .filter((l) => /^\s*\|/.test(l))
      .map((l) => {
        const cells = l
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean);
        const m = (cells[cells.length - 1] || "").match(/^`([^`]+)`$/);
        return m ? m[1] : null;
      })
      .filter(Boolean),
  );
  const undocumented = jobNames.filter((j) => !gateJobs.has(j));
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
  const npmRuns = [...gates.matchAll(/`npm run ([\w:-]+)`/g)].map((m) => m[1]);
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

  // The reverse of the two checks above: every command the table NAMES resolves,
  // but nothing yet asks whether every command CI actually RUNS is named. A row
  // silently dropped while its job keeps a different step (say, coverage:check cut
  // from the `test` job while syntax-check and run-all stay) would pass both prior
  // checks and every check above — CI would still enforce a gate this file no
  // longer documents.
  //
  // A command can appear on each side in either form — `npm run X` or the `node
  // path.js` the script ultimately runs — and the two sides don't always agree on
  // which: CI runs coverage:check as `node scripts/testing/build-coverage-inventory.js
  // --check` while the table names it `npm run coverage:check`. So compare by
  // RESOLVED IDENTITY: an npm-run name resolves to package.json's script text; a
  // node path resolves to itself. A CI command is documented if either its own
  // form or its resolved form appears, in either form, on the table's side.
  const resolve = (npmName) => scriptText(scripts, npmName);
  const documented = new Set([
    ...npmRuns,
    ...npmRuns.map(resolve).filter(Boolean),
    ...nodeRuns,
  ]);
  const isDocumented = (cmd) =>
    documented.has(cmd) || [...documented].some((d) => d.includes(cmd));

  const ciNpmRuns = [...ci.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
  const ciNodeRuns = [...ci.matchAll(/node ([\w./-]+\.js)/g)].map((m) => m[1]);
  // test:visual:update is the one npm-run step CI executes that is deliberately
  // NOT a gate: it runs only on a manual workflow_dispatch with update_baselines
  // set, to regenerate the committed -linux screenshots a human then commits, and
  // it never blocks a PR. It is documented in prose (see "Visual" below), not the
  // gate table, so it is excluded here rather than misread as an undocumented gate.
  const undocumentedInCI = [
    ...ciNpmRuns.filter((s) => s !== "test:visual:update" && !isDocumented(s)),
    ...ciNodeRuns.filter((p) => !isDocumented(p)),
  ];
  check(
    "CI runs no gate command the table fails to document",
    undocumentedInCI.length === 0,
    undocumentedInCI.length
      ? `${undocumentedInCI.join(",")} — add a row to tests/README.md`
      : `${ciNpmRuns.length + ciNodeRuns.length} CI commands documented`,
  );
}

if (state.failures) {
  console.error(`\ndocs-currency: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\ndocs-currency: all checks passed");
  process.exitCode = 0;
}
