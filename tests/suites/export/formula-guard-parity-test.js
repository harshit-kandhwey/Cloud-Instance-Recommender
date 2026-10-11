// formula-guard-parity suite: one decision about what a spreadsheet would execute.
// Three export paths each carried their own copy of the guard: the CSV cell, the
// clipboard row, and the AWS bulk template. They had already diverged: the clipboard
// prefixed a plain negative number that the CSV leaves alone, so a pasted column of
// negatives arrived as text and stopped summing, and the template guarded characters
// the clipboard did not. Covered: the decision table itself, that every surface
// agrees with it, and that the pattern exists in exactly one place so a fourth copy
// cannot appear unnoticed.
const fs = require("fs");
const path = require("path");
const { REPO, buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const { run, ctx } = buildContext();

// [cell, guarded?] — the guard is a decision about the cell alone.
const TABLE = [
  ["=1+1", true],
  ["=cmd|'/c calc'!A1", true],
  ["+1", true],
  ["-cmd", true],
  ["-1+1", true],
  ["-1e5", true],
  ["-", true],
  ["@SUM(A1)", true],
  ["|x", true],
  ["\t=1", true],
  ["\r=1", true],
  ["-5", false],
  ["-5.25", false],
  ["5", false],
  ["m5.large", false],
  ["a=b", false],
  ["web-01", false],
  ["", false],
];

const guarded = (s) => typeof s === "string" && s.startsWith("'");
const unquote = (s) =>
  s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s;

// ── the one decision ─────────────────────────────────────────────────────────────
for (const [cell, expected] of TABLE) {
  ctx.__cell = cell;
  const out = run("guardFormula(__cell)");
  check(
    `guardFormula(${JSON.stringify(cell)}) is ${expected ? "prefixed" : "left alone"}`,
    guarded(out) === expected && (expected ? out === `'${cell}` : out === cell),
    JSON.stringify(out),
  );
}
check(
  "a missing value is the empty string, not the text null",
  run("guardFormula(null)") === "" && run("guardFormula(undefined)") === "",
);

// ── every surface agrees ─────────────────────────────────────────────────────────
const disagree = [];
for (const [cell, expected] of TABLE) {
  ctx.__cell = cell;
  const csv = unquote(run("escapeCsvCell(__cell)"));
  const tsv = run('buildPreviewTsv([{ c: __cell }], ["c"])').split("\n")[1];
  // The clipboard collapses tabs and line breaks to spaces and trims, as before.
  const csvGuarded = guarded(csv);
  const tsvGuarded = guarded(tsv);
  if (csvGuarded !== expected || tsvGuarded !== expected) {
    disagree.push(
      `${JSON.stringify(cell)}: csv=${csvGuarded} tsv=${tsvGuarded} want=${expected}`,
    );
  }
}
check(
  "the CSV cell and the clipboard row make the same decision for every cell",
  disagree.length === 0,
  disagree.join(" | "),
);
{
  ctx.__cell = "-12.5";
  const tsv = run('buildPreviewTsv([{ c: __cell }], ["c"])').split("\n")[1];
  check(
    "a negative number pastes as a number, not as text",
    tsv === "-12.5",
    tsv,
  );
  ctx.__cell = "=HYPERLINK(1)";
  const header = run("buildPreviewTsv([], [__cell])").split("\n")[0];
  check("a header is guarded like a cell", header === "'=HYPERLINK(1)", header);
}

// The AWS bulk template builds its cells inside the export function, so the guard is
// checked in its source: it must call the shared guard and carry no pattern of its own.
{
  const body = run("downloadAWSBulkTemplate.toString()");
  const calls = body.split("guardFormula(").length - 1;
  check(
    "the AWS bulk template guards both its description and its cells through guardFormula",
    calls >= 2,
    `${calls} calls`,
  );
}

// ── exactly one definition of the pattern ───────────────────────────────────────
{
  const walk = (dir) =>
    fs
      .readdirSync(path.join(REPO, dir), { withFileTypes: true })
      .flatMap((e) => {
        const rel = path.posix.join(dir, e.name);
        if (e.isDirectory()) return /vendor|regions/.test(rel) ? [] : walk(rel);
        return rel.endsWith(".js") ? [rel] : [];
      });
  // The formula starters as they appear inside a character class in source text.
  const STARTERS = "=+\\-@|";
  const holders = walk("src").filter((f) =>
    fs.readFileSync(path.join(REPO, f), "utf8").includes(STARTERS),
  );
  check(
    "the scan sees the one definition",
    holders.includes("src/shared/app-core.js"),
    holders.join(", "),
  );
  check(
    "no other source file spells out the formula starters",
    holders.length === 1 && holders[0] === "src/shared/app-core.js",
    holders.join(", "),
  );
}

if (state.failures) {
  console.error(`\nformula-guard-parity: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nformula-guard-parity: all checks passed");
  process.exitCode = 0;
}
