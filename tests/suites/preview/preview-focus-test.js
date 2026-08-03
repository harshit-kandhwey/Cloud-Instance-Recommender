// Every view-changing interaction re-renders the preview, which REPLACES the
// node the user was on. Without a restore, a keyboard user is dropped back to
// the body on every page turn, page-size change, no-match toggle, column
// show/hide and sort — losing their place each time. Each handler records the
// control to focus again, and the ids are stable across the re-render.
//
// Also pinned here: hiding a FILTERED column widens the row set, so it must
// reset the page like every other view-changing handler — while hiding an
// unfiltered column changes no rows and must NOT jump the user back to page 1.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const row = (i) => ({
  "VM Name": `vm-${String(i).padStart(2, "0")}`,
  "CPU Count": String((i % 8) + 1),
  "Memory (GB)": String(((i % 8) + 1) * 4),
  "AWS Like-to-Like Instance": i % 5 === 0 ? "No Match" : "m5.large",
  "AWS Optimized Instance": i % 5 === 0 ? "No Match" : "t3.medium",
});
// 60 rows → more than one page at the default page size of 25.
const ROWS = Array.from({ length: 60 }, (_, i) => row(i));

// Focus is only meaningfully restored if the id it targets actually exists in
// the rendered markup. getElementById in the harness fabricates any id it is
// asked for, so asserting `focused` alone would pass on a typo'd id — assert
// both: the element was focused AND the real markup carries that id.
const focusedRealControl = (elements, id) =>
  elements[id] &&
  elements[id].focused === true &&
  elements.resultsPreviewSection.innerHTML.includes(`id="${id}"`);

console.log("[a page turn keeps focus on the nav button]");
{
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview(ROWS);
  ctx._previewGoToPage(1);
  check(
    "Next keeps focus on the Next button, not the body",
    focusedRealControl(elements, "previewNavNext"),
    `focused=${elements.previewNavNext && elements.previewNavNext.focused}`,
  );
}
{
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview(ROWS);
  ctx._previewGoToPage(1);
  // The forward turn above must not be what satisfies this assertion.
  if (elements.previewNavPrev) elements.previewNavPrev.focused = false;
  ctx._previewGoToPage(0);
  check(
    "Prev keeps focus on the Prev button",
    focusedRealControl(elements, "previewNavPrev"),
    `focused=${elements.previewNavPrev && elements.previewNavPrev.focused}`,
  );
}

console.log("[the other view controls keep focus too]");
{
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview(ROWS);
  ctx._previewSetPageSize("50");
  check(
    "rows-per-page keeps focus on the select",
    focusedRealControl(elements, "previewPageSize"),
  );
}
{
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview(ROWS);
  ctx._previewToggleNoMatch(true);
  check(
    "the no-match toggle keeps focus on its checkbox",
    focusedRealControl(elements, "previewNoMatchOnly"),
  );
}
{
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview(ROWS);
  ctx._previewToggleColumn(1, false);
  check(
    "hiding a column keeps focus on that column's checkbox",
    focusedRealControl(elements, "previewColToggle_1"),
  );
}
{
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview(ROWS);
  ctx._sortPreview(2);
  check(
    "sorting keeps focus on the sorted header",
    focusedRealControl(elements, "previewSortTh_2"),
  );
}

console.log("[hiding a column resets the page only when it was filtered]");
{
  // Filtered column + deep page: dropping the filter widens the row set, so the
  // page index must go back to 0 like every other view-changing handler.
  const { ctx } = buildContext();
  ctx.showResultsPreview(ROWS);
  const s = ctx._previewState;
  const col = s.displayCols[1];
  s.columnFilters[col] = "4";
  s.page = 2;
  ctx._previewToggleColumn(1, false);
  check(
    "hiding a FILTERED column resets to the first page",
    ctx._previewState.page === 0,
    `page=${ctx._previewState.page}`,
  );
  check(
    "and drops that column's filter",
    !(col in ctx._previewState.columnFilters),
    JSON.stringify(ctx._previewState.columnFilters),
  );
}
{
  // No filter on that column → the row set is unchanged → the user must stay
  // where they were rather than being thrown back to page 1.
  const { ctx } = buildContext();
  ctx.showResultsPreview(ROWS);
  ctx._previewState.page = 2;
  ctx._previewToggleColumn(1, false);
  check(
    "hiding an UNFILTERED column leaves the page where it was",
    ctx._previewState.page === 2,
    `page=${ctx._previewState.page}`,
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;
