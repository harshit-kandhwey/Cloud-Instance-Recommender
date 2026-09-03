// changelog-integrity suite: pins the two structural invariants of
// CHANGELOG.md's version map that were, until now, verified by hand — a
// one-off shell command re-typed after nearly every edit this repo's own
// history has made to the file, which is exactly the kind of manual toil a
// pipe typo or a skipped check survives inside. Both are genuine failure
// modes with real consequences, not style preferences:
//   - A literal, unescaped `|` in a version-map row's prose breaks the
//     Markdown table it sits in — Prettier pads an escaped `\|` into phantom
//     columns instead of catching it, so the row can drift silently.
//   - More than one row carrying the `_this commit_` placeholder means a
//     backfill was missed on some earlier commit — the version map can no
//     longer say which SHA a row actually landed at.
//
// Scoped to the NEWEST (currently open) minor section only, not the whole
// file: four rows from 2026-07 through 2026-08, before this discipline
// existed, genuinely have a stray `|` in their prose (NF 7/8/10/16, not 6).
// They are shipped, published history — not a defect this suite exists to
// re-litigate. The live risk is in the section still being written, which is
// always the first `### x.y` heading under the version map.
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const changelog = fs.readFileSync(path.join(REPO, "CHANGELOG.md"), "utf8");

// ── Exactly one `_this commit_` placeholder in the whole file ───────────────────
// Global, not section-scoped: only one commit is ever "the tip," regardless of
// which minor it belongs to. The convention note that explains the placeholder
// also contains the phrase once, in prose — so the count is 2, not 1.
{
  const count = (changelog.match(/_this commit_/g) || []).length;
  check(
    "exactly one version-map row carries the _this commit_ placeholder",
    count === 2,
    `found the phrase ${count} time(s) (want 2: the convention note + the tip row) — ` +
      (count > 2
        ? "a backfill was likely missed on an earlier commit"
        : "the convention note itself may have been edited or removed"),
  );
}

// ── The newest minor section's rows are well-formed table cells ─────────────────
{
  const mapStart = changelog.indexOf("## Version map");
  check("CHANGELOG.md has a Version map section", mapStart !== -1);

  const firstHeading = changelog.indexOf("\n### ", mapStart);
  check(
    "the version map has at least one minor section",
    firstHeading !== -1,
    firstHeading === -1 ? "no ### heading found after ## Version map" : "",
  );

  const nextHeading = changelog.indexOf("\n### ", firstHeading + 1);
  const newestSection = changelog.slice(
    firstHeading,
    nextHeading === -1 ? changelog.length : nextHeading,
  );

  const heading = (newestSection.match(/^\n?### (.+)$/m) || ["", "(none)"])[1];
  const rows = newestSection
    .split("\n")
    .filter((l) => /^\| \d+\.\d+\.\d+ /.test(l));
  check(
    `the newest section ("${heading}") has version-map rows to check`,
    rows.length > 0,
    `${rows.length} row(s)`,
  );

  const malformed = rows.filter((r) => r.split("|").length !== 6);
  check(
    "every row in the newest section splits into exactly 6 pipe-delimited fields",
    malformed.length === 0,
    malformed.length
      ? malformed
          .map((r) => `"${r.slice(0, 60)}…" (${r.split("|").length} fields)`)
          .join(" | ")
      : "",
  );
}

if (state.failures) {
  console.error(`\nchangelog-integrity: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nchangelog-integrity: all checks passed");
  process.exitCode = 0;
}
