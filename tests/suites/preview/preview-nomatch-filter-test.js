// The "no-match only" toggle restricts the results table to rows where every
// recommendation is a no-match — the same rows the red highlight marks. It runs
// through the one shared filter, so the clipboard narrows with it, and it
// composes with the text filter and pagination rather than replacing them.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const matched = (name) => ({
  "VM Name": name,
  "CPU Count": "4",
  "Memory (GB)": "16",
  "AWS Like-to-Like Instance": "m5.xlarge",
  "AWS Optimized Instance": "t3.large",
  "AWS No Match Reason": "",
});
// Both recommendation columns are a no-match, so the row is unmatched. A row with
// only ONE column unmatched is NOT — the predicate needs every one.
const noMatch = (name) => ({
  "VM Name": name,
  "CPU Count": "999",
  "Memory (GB)": "9999",
  "AWS Like-to-Like Instance": "No Match",
  "AWS Optimized Instance": "No Match",
  "AWS No Match Reason": "Nothing that large",
});

// web-01, huge-01(no), web-02, db-01, huge-02(no), db-02 → 2 unmatched of 6.
const MIXED = [
  matched("web-01"),
  noMatch("huge-01"),
  matched("web-02"),
  matched("db-01"),
  noMatch("huge-02"),
  matched("db-02"),
];

const namesShown = (html) =>
  ["web-01", "web-02", "db-01", "db-02", "huge-01", "huge-02"].filter((n) =>
    html.includes(`>${n}<`),
  );
const dangerRowCount = (html) =>
  (html.match(/background:var\(--danger-bg-soft\)/g) || []).length;
const renderedRowCount = (html) =>
  (html.match(/aria-label="Copy row \d+"/g) || []).length;

console.log("[the toggle keeps only the unmatched rows]");
{
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview(MIXED);
  ctx._previewToggleNoMatch(true);
  const html = elements.resultsPreviewSection.innerHTML;

  check(
    "only the two unmatched rows are shown",
    namesShown(html).sort().join(",") === "huge-01,huge-02",
    namesShown(html).join(","),
  );
  check(
    "and the matched rows are gone",
    !html.includes(">web-01<") && !html.includes(">db-02<"),
  );
  check(
    "the count line calls them unmatched, against the whole",
    html.includes("1–2 of 2 unmatched rows (6 total)"),
    html.match(/Results Preview \([^)]*\)/)?.[0],
  );
  check(
    "the footer reminds that downloads still carry everything",
    /Showing 2 of 6 rows \(no-match only\)\. Downloads always contain the full 6-row/.test(
      html,
    ),
    html.match(/Showing[^<]*/)?.[0],
  );
}

console.log("[every row shown under the toggle is a red row]");
{
  // The filter and the highlight must use ONE predicate: if they diverged, the
  // toggle could show a row the highlight does not mark, or hide one it does.
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview(MIXED);
  ctx._previewToggleNoMatch(true);
  const html = elements.resultsPreviewSection.innerHTML;
  check(
    "the number of red rows equals the number of rows shown",
    dangerRowCount(html) === renderedRowCount(html) &&
      renderedRowCount(html) === 2,
    `red=${dangerRowCount(html)} shown=${renderedRowCount(html)}`,
  );
}

console.log("[the clipboard narrows with the toggle]");
{
  // Drive the REAL copy path and capture what it hands the clipboard. Calling
  // filterAndSortRows directly instead would only prove the helper filters — it
  // would stay green if copyPreviewToClipboard stopped forwarding noMatchOnly,
  // which is exactly the regression this test exists to catch. Reassigning the
  // context's copyTextToClipboard intercepts the internal call.
  const { ctx } = buildContext();
  ctx.showResultsPreview(MIXED);
  ctx._previewToggleNoMatch(true);

  let captured = null;
  ctx.copyTextToClipboard = (text) => {
    captured = text;
  };
  ctx.copyPreviewToClipboard();

  check(
    "the copy actually ran and produced text",
    typeof captured === "string" && captured.length > 0,
  );
  const copiedNames = (captured || "")
    .split("\n")
    .slice(1)
    .map((l) => l.split("\t")[0])
    .filter(Boolean);
  check(
    "the clipboard carries exactly the unmatched rows",
    copiedNames.sort().join(",") === "huge-01,huge-02",
    JSON.stringify(copiedNames),
  );

  // And with the toggle off the copy widens back to all six.
  ctx._previewToggleNoMatch(false);
  captured = null;
  ctx.copyPreviewToClipboard();
  const allNames = (captured || "")
    .split("\n")
    .slice(1)
    .map((l) => l.split("\t")[0])
    .filter(Boolean);
  check(
    "with the toggle off the clipboard carries all six",
    allNames.length === 6,
    JSON.stringify(allNames),
  );
}

console.log("[the toggle composes with the text filter, not replaces it]");
{
  const { ctx } = buildContext();
  ctx.showResultsPreview(MIXED);
  const { displayCols } = ctx._previewState;
  // Both narrowings apply: unmatched AND matching "huge-02".
  const both = ctx.filterAndSortRows(
    MIXED,
    displayCols,
    "huge-02",
    null,
    1,
    true,
  );
  check(
    "unmatched-and-text leaves just the one row",
    both.length === 1 && both[0]["VM Name"] === "huge-02",
    JSON.stringify(both.map((r) => r["VM Name"])),
  );
  // A matched row that matches the text is still excluded by the toggle.
  const matchedText = ctx.filterAndSortRows(
    MIXED,
    displayCols,
    "web-01",
    null,
    1,
    true,
  );
  check(
    "a matched row is not rescued by matching the text",
    matchedText.length === 0,
    JSON.stringify(matchedText.map((r) => r["VM Name"])),
  );
}

console.log("[the toggle composes with pagination]");
{
  // 30 unmatched among 60, page size default 25 → the unmatched set spans two
  // pages, and the page window is a window onto the unmatched rows.
  const many = [];
  for (let i = 0; i < 60; i++) {
    many.push(i % 2 === 0 ? noMatch(`no-${i}`) : matched(`ok-${i}`));
  }
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview(many);
  ctx._previewToggleNoMatch(true);
  let html = elements.resultsPreviewSection.innerHTML;
  check(
    "page 1 shows 25 of the 30 unmatched rows",
    renderedRowCount(html) === 25 &&
      html.includes("1–25 of 30 unmatched rows (60 total)"),
    html.match(/Results Preview \([^)]*\)/)?.[0],
  );
  ctx._previewGoToPage(1);
  html = elements.resultsPreviewSection.innerHTML;
  check(
    "page 2 shows the remaining 5",
    renderedRowCount(html) === 5 && html.includes("26–30 of 30 unmatched rows"),
    html.match(/Results Preview \([^)]*\)/)?.[0],
  );
  check(
    "and only unmatched rows appear",
    !html.includes(">ok-"),
    "matched row leaked onto the page",
  );
}

console.log("[with nothing unmatched the toggle says so]");
{
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview([matched("web-01"), matched("db-01")]);
  ctx._previewToggleNoMatch(true);
  const html = elements.resultsPreviewSection.innerHTML;
  check(
    "an all-matched run reports no unmatched rows, not an empty table with no reason",
    html.includes("No unmatched rows — every row found an instance."),
    html.match(/No unmatched[^<]*/)?.[0] || "(message absent)",
  );

  // And turning it back off restores the full set.
  ctx._previewToggleNoMatch(false);
  const back = elements.resultsPreviewSection.innerHTML;
  check(
    "clearing the toggle brings the matched rows back",
    back.includes(">web-01<") && back.includes(">db-01<"),
  );
}

console.log("[a partially-matched row is matched, not unmatched]");
{
  // One recommendation found, the other not. This VM DID find an instance, so it
  // is not a no-match — the predicate is "every recommendation is a no-match",
  // not "any". This is the case that separates the two: on a fixture where
  // unmatched rows fail all columns and matched rows fail none, all/any agree.
  const partial = {
    "VM Name": "partial-01",
    "CPU Count": "8",
    "Memory (GB)": "32",
    "AWS Like-to-Like Instance": "m5.2xlarge", // found this one
    "AWS Optimized Instance": "No Match", // but not this one
    "AWS No Match Reason": "",
  };
  const rows = [partial, noMatch("huge-01")];
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview(rows);
  const { displayCols } = ctx._previewState;

  const narrowed = ctx.filterAndSortRows(rows, displayCols, "", null, 1, true);
  check(
    "only the fully-unmatched row survives; the partial one found an instance",
    narrowed.length === 1 && narrowed[0]["VM Name"] === "huge-01",
    JSON.stringify(narrowed.map((r) => r["VM Name"])),
  );

  ctx._previewToggleNoMatch(true);
  const html = elements.resultsPreviewSection.innerHTML;
  check(
    "the partial row is not shown under no-match-only",
    !html.includes(">partial-01<"),
    "partial row leaked into the no-match view",
  );
  check(
    "and it is not painted as a no-match row",
    dangerRowCount(html) === 1,
    `red rows = ${dangerRowCount(html)}`,
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;
