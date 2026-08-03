// Columns can be hidden from the results table. Hiding is display-only: a hidden
// column still filters and sorts, and it is still in every download — it is just
// absent from the on-screen table and, like a filtered-out row, from the copy.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const row = (name, env) => ({
  "VM Name": name,
  "CPU Count": "4",
  "Memory (GB)": "16",
  ENV: env,
  "AWS Like-to-Like Instance": "m5.xlarge",
  "AWS Like-to-Like vCPUs": "4",
  "AWS Like-to-Like Memory (GiB)": "16",
});

const ROWS = [
  row("web-01", "Production"),
  row("web-02", "Staging"),
  row("db-01", "Production"),
];

const colIndex = (ctx, name) => ctx._previewState.displayCols.indexOf(name);

// A column header cell carries the sort handler for that column index.
// Escape the column name before embedding it in a regex — a real column like
// "Memory (GB)" carries regex metacharacters, and unescaped `(GB)` would be read
// as a capture group and silently fail to match the literal header.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const headerShown = (html, ctx, name) =>
  html.includes(`window._sortPreview(${colIndex(ctx, name)})`) &&
  new RegExp(`>${escapeRe(name)}(<|\\u21c5|\\u25b2|\\u25bc)`).test(html);

const settle = () => new Promise((r) => setTimeout(r, 250));

(async () => {
  console.log("[a column menu lists every column, all shown to begin with]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(ROWS);
    const html = elements.resultsPreviewSection.innerHTML;
    check(
      "the menu offers each column with a checkbox",
      /_previewToggleColumn\(/.test(html) &&
        html.includes('aria-label="Show column ENV"'),
      "(no column menu)",
    );
    check(
      "every column starts checked (visible)",
      (html.match(/_previewToggleColumn\(\d+, this\.checked\)/g) || [])
        .length === ctx._previewState.displayCols.length &&
        !/\(\d+ hidden\)/.test(html),
    );
  }

  console.log("[hiding a column drops it from the table]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(ROWS);
    check(
      "ENV starts visible in the header",
      headerShown(elements.resultsPreviewSection.innerHTML, ctx, "ENV"),
    );

    ctx._previewToggleColumn(colIndex(ctx, "ENV"), false);
    const html = elements.resultsPreviewSection.innerHTML;
    check(
      "its header is gone",
      !headerShown(html, ctx, "ENV"),
      "ENV header still present",
    );
    check(
      "its filter input is gone too",
      !html.includes(`id="colfilter_${colIndex(ctx, "ENV")}"`),
    );
    check(
      "the values Production/Staging no longer appear as cells",
      !/>Production</.test(html) && !/>Staging</.test(html),
    );
    check("the menu counts one hidden", html.includes("(1 hidden)"));
    check(
      "but the rows are all still there — hiding a column is not filtering",
      ["web-01", "web-02", "db-01"].every((n) => html.includes(`>${n}<`)),
    );
  }

  console.log("[a hidden column still filters and sorts]");
  {
    const { ctx } = buildContext();
    ctx.showResultsPreview(ROWS);
    const displayCols = ctx._previewState.displayCols;
    ctx._previewToggleColumn(colIndex(ctx, "ENV"), false);

    // The global search still matches the hidden column's values — filtering sees
    // every column, visible or not.
    const narrowed = ctx.filterAndSortRows(
      ROWS,
      displayCols,
      "Staging",
      null,
      1,
      false,
      {},
    );
    check(
      "the global search still finds rows by the hidden column",
      narrowed.length === 1 && narrowed[0]["VM Name"] === "web-02",
      JSON.stringify(narrowed.map((r) => r["VM Name"])),
    );
  }

  console.log("[hiding a filtered column clears its filter]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(ROWS);
    ctx._previewColumnFilterChanged(colIndex(ctx, "ENV"), "Production");
    await settle();
    check(
      "the filter narrows first",
      ctx._previewState.columnFilters.ENV === "Production",
    );

    ctx._previewToggleColumn(colIndex(ctx, "ENV"), false);
    check(
      "hiding the column removes its filter — no invisible narrowing",
      !("ENV" in ctx._previewState.columnFilters),
      JSON.stringify(ctx._previewState.columnFilters),
    );
    const html = elements.resultsPreviewSection.innerHTML;
    check(
      "so every row is back",
      ["web-01", "web-02", "db-01"].every((n) => html.includes(`>${n}<`)),
    );
  }

  console.log("[showing a hidden column brings it back]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(ROWS);
    ctx._previewToggleColumn(colIndex(ctx, "ENV"), false);
    ctx._previewToggleColumn(colIndex(ctx, "ENV"), true);
    const html = elements.resultsPreviewSection.innerHTML;
    check(
      "the header and values return",
      headerShown(html, ctx, "ENV") && />Production</.test(html),
      "ENV header/value did not return",
    );
    check("and the hidden count is gone", !/\(\d+ hidden\)/.test(html));
    check("the hidden set is empty", ctx._previewState.hiddenCols.size === 0);
  }

  console.log("[the last visible column cannot be hidden]");
  {
    const { ctx } = buildContext();
    ctx.showResultsPreview(ROWS);
    const displayCols = [...ctx._previewState.displayCols];
    // Hide every column but the last.
    for (let i = 0; i < displayCols.length - 1; i++) {
      ctx._previewToggleColumn(i, false);
    }
    const beforeLast = ctx._previewState.hiddenCols.size;
    // Attempt to hide the final one.
    ctx._previewToggleColumn(displayCols.length - 1, false);
    check(
      "one column always remains visible",
      ctx._previewState.hiddenCols.size === beforeLast &&
        ctx._previewState.hiddenCols.size === displayCols.length - 1,
      `hidden ${ctx._previewState.hiddenCols.size} of ${displayCols.length}`,
    );
  }

  console.log("[the clipboard copies only the visible columns]");
  {
    const { ctx } = buildContext();
    ctx.showResultsPreview(ROWS);
    ctx._previewToggleColumn(colIndex(ctx, "ENV"), false);

    // Drive the REAL copy path and capture what it hands the clipboard, so the
    // column selection under test is copyPreviewToClipboard's own — not one the
    // test recomputed. Reassigning the context's copyTextToClipboard intercepts
    // the internal call.
    let captured = null;
    ctx.copyTextToClipboard = (text) => {
      captured = text;
    };
    ctx.copyPreviewToClipboard();

    check(
      "the copy actually ran and produced text",
      typeof captured === "string" && captured.length > 0,
    );
    const header = (captured || "").split("\n")[0];
    check(
      "the copied header omits the hidden column but keeps the visible ones",
      !header.includes("ENV") && header.includes("VM Name"),
      header,
    );
  }

  console.log("[the menu stays open across a toggle]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(ROWS);
    ctx._previewColsMenuState(true); // user opened it
    ctx._previewToggleColumn(colIndex(ctx, "ENV"), false);
    const html = elements.resultsPreviewSection.innerHTML;
    check(
      "the details element re-renders open, so it does not snap shut",
      /<details[^>]*\bopen\b/.test(html),
      html.match(/<details[^>]*>/)?.[0],
    );
  }

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = state.failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
