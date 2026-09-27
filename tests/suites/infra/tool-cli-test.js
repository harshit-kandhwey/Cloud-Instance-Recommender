// Each data tool's main() is only reachable by running the tool as a CLI, so
// the helper suites cannot execute it. These runs feed every tool an argument
// it must reject before it touches the network or writes a file, and pin that
// it exits non-zero with a message that names the bad input.
const path = require("path");
const { spawnSync } = require("child_process");
const { makeChecker, REPO } = require("../harness");

const { check, state } = makeChecker();

const CASES = [
  ["data-diff", ["--provider", "nope"], /unknown --provider nope/],
  ["reconcile-data", ["--provider", "nope"], /unknown --provider nope/],
  [
    "recommendation-diff",
    ["--provider", "nope"],
    /unknown --provider nope \(expected one of: aws, azure, gcp\)/,
  ],
  [
    "fetch-vantage",
    ["--provider", "nope", "--date", "2026-01-01"],
    /unknown --provider nope/,
  ],
  [
    "fetch-official-aws",
    ["--region", "nope"],
    /--region nope is not a shipped region/,
  ],
  [
    "fetch-official-azure",
    ["--region", "nope"],
    /--region nope is not a shipped region/,
  ],
  [
    "fetch-official-gcp",
    ["--region", "nope"],
    /--region nope is not a shipped region/,
  ],
  ["refresh-local", ["--date", "bogus"], /invalid --date bogus/],
];

for (const [tool, args, expected] of CASES) {
  const res = spawnSync(
    process.execPath,
    [path.join(REPO, "scripts", "data", `${tool}.js`), ...args],
    { cwd: REPO, encoding: "utf8", timeout: 60000 },
  );
  // A failed spawn or the timeout sets res.error and can leave the streams null;
  // reading them bare would throw and end the loop, so no later tool is checked.
  const stdout = res.stdout || "";
  const stderr = res.stderr || "";
  check(`${tool} ran to completion`, !res.error, String(res.error));
  const out = `${stdout}${stderr}`;
  check(
    `${tool} ${args.join(" ")} exits 1`,
    res.status === 1,
    `status ${res.status} ${out.slice(0, 200)}`,
  );
  check(
    `${tool} names the bad input`,
    expected.test(stderr),
    stderr.slice(0, 200),
  );
  check(
    `${tool} reports the failure without a stack trace`,
    !/\n\s+at /.test(stderr),
    stderr.slice(0, 300),
  );
}

if (state.failures) {
  console.error(`\ntool-cli: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\ntool-cli: all checks passed");
  process.exitCode = 0;
}
