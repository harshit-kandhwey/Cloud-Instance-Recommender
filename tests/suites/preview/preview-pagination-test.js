// The results table pages through the whole result set instead of stopping at a
// fixed 20. Pagination is applied AFTER filter and sort, and the clipboard and
// downloads ignore it — a page is a viewing window, never a narrowing of what
// leaves the tool.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

// N rows, distinct and sortable by name, so a page window can be checked by which
// rows it contains.
function makeResults(n) {
  return Array.from({ length: n }, (_, i) => ({
    "VM Name": `vm-${String(i + 1).padStart(3, "0")}`,
    "CPU Count": "4",
    "Memory (GB)": "16",
    "AWS Like-to-Like Instance": "m5.xlarge",
    "AWS Like-to-Like vCPUs": "4",
    "AWS Like-to-Like Memory (GiB)": "16",
  }));
}

// Data rows carry a per-row copy button labelled with the row's absolute number.
const renderedRowNumbers = (html) =>
  [...html.matchAll(/aria-label="Copy row (\d+)"/g)].map((m) => Number(m[1]));

const settle = () => new Promise((r) => setTimeout(r, 250)); // 150ms filter debounce

(async () => {
  console.log("[the first page is a window, not the whole set]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(makeResults(60));
    const html = elements.resultsPreviewSection.innerHTML;
    const rows = renderedRowNumbers(html);

    check(
      "the default page shows 25 rows, not all 60 and not the old 20",
      rows.length === 25,
      `rendered ${rows.length}`,
    );
    check(
      "numbered 1 through 25",
      rows[0] === 1 && rows[24] === 25,
      JSON.stringify([rows[0], rows[rows.length - 1]]),
    );
    check(
      "the count line names the window and the whole",
      html.includes("1–25 of 60 rows"),
      html.match(/Results Preview \([^)]*\)/)?.[0],
    );
    check(
      "a nav appears, because there is more than one page",
      html.includes("Page 1 of 3"),
    );
    const prevBtn =
      html.match(/<button[^>]*aria-label="Previous page"[^>]*>/)?.[0] || "";
    check(
      "Prev is disabled on the first page",
      /disabled/.test(prevBtn),
      prevBtn,
    );
    check(
      "the copy-all control still claims every row, not just this page",
      html.includes("all 60"),
      html.match(/title="Copy every[^"]*"/)?.[0],
    );

    // And the claim is true. Asserting only the tooltip would leave the promise
    // untested — the copy could silently narrow to the current page and this
    // suite would stay green. Drive the REAL copy path and count what it hands
    // the clipboard; reassigning copyTextToClipboard intercepts the internal call.
    let captured = null;
    ctx.copyTextToClipboard = (text) => {
      captured = text;
    };
    ctx.copyPreviewToClipboard();
    const copiedRows = (captured || "")
      .split("\n")
      .slice(1)
      .filter((l) => l.trim() !== "");
    check(
      "and the copy really carries all 60 rows, not the 25 on this page",
      copiedRows.length === 60,
      `copied ${copiedRows.length} rows`,
    );
  }

  console.log("[later pages carry later rows, numbered absolutely]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(makeResults(60));

    ctx._previewGoToPage(1);
    let html = elements.resultsPreviewSection.innerHTML;
    let rows = renderedRowNumbers(html);
    check(
      "page 2 shows rows 26–50",
      rows[0] === 26 && rows[rows.length - 1] === 50 && rows.length === 25,
      JSON.stringify([rows[0], rows[rows.length - 1], rows.length]),
    );
    check("its count line agrees", html.includes("26–50 of 60 rows"));
    check("and it says page 2 of 3", html.includes("Page 2 of 3"));

    ctx._previewGoToPage(2);
    html = elements.resultsPreviewSection.innerHTML;
    rows = renderedRowNumbers(html);
    check(
      "the last page holds the remainder (51–60), short by design",
      rows[0] === 51 && rows[rows.length - 1] === 60 && rows.length === 10,
      JSON.stringify([rows[0], rows[rows.length - 1], rows.length]),
    );
    const nextBtn =
      html.match(/<button[^>]*aria-label="Next page"[^>]*>/)?.[0] || "";
    check(
      "Next is disabled on the last page",
      /disabled/.test(nextBtn),
      nextBtn,
    );

    // A page index past the end is clamped by the render itself, independent of
    // any reset — so a stray jump shows the last page, never a blank one.
    ctx._previewGoToPage(99);
    html = elements.resultsPreviewSection.innerHTML;
    rows = renderedRowNumbers(html);
    check(
      "jumping past the end lands on the last page, not an empty one",
      rows[0] === 51 && rows.length === 10 && html.includes("Page 3 of 3"),
      JSON.stringify([rows[0], rows.length]),
    );
  }

  console.log("[page size is the user's choice, and All means one page]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(makeResults(60));

    ctx._previewSetPageSize("all");
    let html = elements.resultsPreviewSection.innerHTML;
    check(
      "All shows every row on one page",
      renderedRowNumbers(html).length === 60,
      `rendered ${renderedRowNumbers(html).length}`,
    );
    check("with no nav to page through", !html.includes("Page 1 of"));
    check("and the count line says so", html.includes("1–60 of 60 rows"));

    ctx._previewSetPageSize("50");
    html = elements.resultsPreviewSection.innerHTML;
    const rows = renderedRowNumbers(html);
    check(
      "a numeric size takes effect and returns to the first page",
      rows.length === 50 && rows[0] === 1,
      JSON.stringify([rows.length, rows[0]]),
    );
    check("with two pages now", html.includes("Page 1 of 2"));
  }

  console.log("[changing what a page means returns to the first page]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(makeResults(60));
    ctx._previewGoToPage(2); // last page

    // Sorting reorders the whole set — page 3's rows are no longer meaningful.
    ctx._sortPreview(0);
    const html = elements.resultsPreviewSection.innerHTML;
    check(
      "sorting drops back to page 1",
      renderedRowNumbers(html)[0] === 1 && html.includes("Page 1 of 3"),
      html.match(/Page \d+ of \d+/)?.[0],
    );
  }

  console.log("[a page beyond the filtered set is clamped, not left blank]");
  {
    const { ctx, elements } = buildContext();
    const results = makeResults(60);
    results[7]["VM Name"] = "keep-me"; // one row that survives the filter
    ctx.showResultsPreview(results);
    ctx._previewGoToPage(2); // page 3 of the full set

    // Filtering to a single row: page 3 no longer exists. The render must clamp
    // rather than show an empty page with the rows scrolled off the end.
    ctx._previewFilterChanged("keep-me");
    await settle();
    const html = elements.resultsPreviewSection.innerHTML;
    check(
      "the one matching row is actually shown, not stranded on a dead page",
      html.includes("keep-me") && renderedRowNumbers(html).length === 1,
      `rendered ${renderedRowNumbers(html).length}`,
    );
    check(
      "and there is no nav, because one row is one page",
      !html.includes("Page 1 of") && html.includes("1–1 of 1 matching rows"),
      html.match(/Results Preview \([^)]*\)/)?.[0],
    );
  }

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = state.failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
