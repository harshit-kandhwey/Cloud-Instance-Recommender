// A filter box under each column narrows on that column alone. Column filters
// AND together and compose with the global search, the no-match toggle and
// pagination, all through the one shared filter — so the clipboard narrows with
// them and a page is always a window onto the filtered set.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const row = (name, env, os) => ({
  "VM Name": name,
  "CPU Count": "4",
  "Memory (GB)": "16",
  ENV: env,
  OS: os,
  "AWS Like-to-Like Instance": "m5.xlarge",
  "AWS Like-to-Like vCPUs": "4",
  "AWS Like-to-Like Memory (GiB)": "16",
});

// Names, ENVs and OSes chosen so a filter on one column does NOT coincide with a
// filter on another — otherwise a column filter could pass by matching the wrong
// column and the test would not notice.
const ROWS = [
  row("web-01", "Production", "Linux"),
  row("web-02", "Staging", "Windows"),
  row("db-01", "Production", "Windows"),
  row("db-02", "Staging", "Linux"),
];

const settle = () => new Promise((r) => setTimeout(r, 250)); // 150ms debounce

// Which VM names appear as row cells (>name<), not counting a filter placeholder.
const namesShown = (html) =>
  ["web-01", "web-02", "db-01", "db-02"].filter((n) => html.includes(`>${n}<`));

// Index of a column in the render's display order, read from the filter inputs.
function colIndex(ctx, name) {
  return ctx._previewState.displayCols.indexOf(name);
}

(async () => {
  console.log("[a filter row of inputs sits under the headers]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(ROWS);
    const html = elements.resultsPreviewSection.innerHTML;
    const envIdx = colIndex(ctx, "ENV");
    check(
      "each column has its own filter input",
      html.includes(`id="colfilter_${envIdx}"`) &&
        html.includes('aria-label="Filter by ENV"'),
      html.match(/aria-label="Filter by ENV"/)?.[0] || "(no ENV filter input)",
    );
  }

  console.log("[a column filter narrows on that column alone]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(ROWS);
    // Filter ENV by "Production" — should keep web-01 and db-01, drop the Staging
    // rows, even though "web" and "db" appear in the VM Name column.
    ctx._previewColumnFilterChanged(colIndex(ctx, "ENV"), "Production");
    await settle();
    const html = elements.resultsPreviewSection.innerHTML;
    check(
      "only rows whose ENV matches remain",
      namesShown(html).sort().join(",") === "db-01,web-01",
      namesShown(html).join(","),
    );
    check(
      "the filter counts as narrowing, so the download reminder shows",
      /Downloads always contain the full 4-row/.test(html),
      html.match(/Showing[^<]*/)?.[0] || "(no reminder)",
    );
    check(
      "a Clear-all control appears once a column filter is set",
      /_previewClearColumnFilters\(\)/.test(html),
    );
  }

  console.log("[a value matching another column does not leak through]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(ROWS);
    // "Linux" is an OS value. Typed into the ENV filter, it must match nothing —
    // the filter is scoped to ENV, not "any column".
    ctx._previewColumnFilterChanged(colIndex(ctx, "ENV"), "Linux");
    await settle();
    const html = elements.resultsPreviewSection.innerHTML;
    check(
      "an OS value in the ENV filter matches no rows",
      namesShown(html).length === 0 &&
        html.includes("No rows match the current filters."),
      namesShown(html).join(",") || "(none)",
    );
  }

  console.log("[two column filters AND together]");
  {
    const { ctx } = buildContext();
    ctx.showResultsPreview(ROWS);
    const displayCols = ctx._previewState.displayCols;
    // ENV=Staging AND OS=Linux → only db-02.
    const narrowed = ctx.filterAndSortRows(
      ROWS,
      displayCols,
      "",
      null,
      1,
      false,
      {
        ENV: "Staging",
        OS: "Linux",
      },
    );
    check(
      "the row must satisfy every active column filter",
      narrowed.length === 1 && narrowed[0]["VM Name"] === "db-02",
      JSON.stringify(narrowed.map((r) => r["VM Name"])),
    );
  }

  console.log("[column filters compose with the global search]");
  {
    const { ctx } = buildContext();
    ctx.showResultsPreview(ROWS);
    const displayCols = ctx._previewState.displayCols;
    // Global "web" (any column) AND column ENV=Production → web-01 only
    // (web-02 is Staging; db-01 is Production but not "web").
    const narrowed = ctx.filterAndSortRows(
      ROWS,
      displayCols,
      "web",
      null,
      1,
      false,
      {
        ENV: "Production",
      },
    );
    check(
      "global search and column filter both apply",
      narrowed.length === 1 && narrowed[0]["VM Name"] === "web-01",
      JSON.stringify(narrowed.map((r) => r["VM Name"])),
    );
  }

  console.log("[the clipboard copies the column-filtered set]");
  {
    const { ctx } = buildContext();
    ctx.showResultsPreview(ROWS);
    ctx._previewState.columnFilters = { OS: "Windows" };

    // Drive the REAL copy path and capture what it hands the clipboard.
    // Re-running filterAndSortRows here instead would only prove that the helper
    // filters — it would stay green if copyPreviewToClipboard stopped forwarding
    // columnFilters at all, which is the one thing this test exists to catch.
    // Reassigning the context's copyTextToClipboard intercepts the internal call.
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
      "only the Windows rows were copied",
      copiedNames.sort().join(",") === "db-01,web-02",
      JSON.stringify(copiedNames),
    );
  }

  console.log("[clearing removes every column filter at once]");
  {
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(ROWS);
    ctx._previewColumnFilterChanged(colIndex(ctx, "ENV"), "Production");
    ctx._previewColumnFilterChanged(colIndex(ctx, "OS"), "Linux");
    await settle();
    check(
      "with both set, only the row matching both remains",
      namesShown(elements.resultsPreviewSection.innerHTML).join(",") ===
        "web-01",
      namesShown(elements.resultsPreviewSection.innerHTML).join(","),
    );
    ctx._previewClearColumnFilters();
    const html = elements.resultsPreviewSection.innerHTML;
    check(
      "clearing brings every row back",
      namesShown(html).length === 4 &&
        Object.keys(ctx._previewState.columnFilters).length === 0,
      namesShown(html).join(","),
    );
  }

  console.log("[an emptied filter is forgotten, not stored as blank]");
  {
    const { ctx } = buildContext();
    ctx.showResultsPreview(ROWS);
    ctx._previewColumnFilterChanged(colIndex(ctx, "ENV"), "Production");
    await settle();
    check(
      "the filter is recorded",
      ctx._previewState.columnFilters.ENV === "Production",
    );
    ctx._previewColumnFilterChanged(colIndex(ctx, "ENV"), "");
    await settle();
    check(
      "clearing the text removes the entry, so nothing reads as still-filtered",
      !("ENV" in ctx._previewState.columnFilters),
      JSON.stringify(ctx._previewState.columnFilters),
    );
  }

  console.log("[column filters compose with pagination]");
  {
    const many = [];
    for (let i = 0; i < 60; i++) {
      many.push(row(`vm-${i}`, i < 30 ? "Production" : "Staging", "Linux"));
    }
    const { ctx, elements } = buildContext();
    ctx.showResultsPreview(many);
    ctx._previewColumnFilterChanged(colIndex(ctx, "ENV"), "Production");
    await settle();
    const html = elements.resultsPreviewSection.innerHTML;
    check(
      "the filtered set (30) pages at 25, not the full 60",
      html.includes("1–25 of 30 matching rows (60 total)") &&
        html.includes("Page 1 of 2"),
      html.match(/Results Preview \([^)]*\)/)?.[0],
    );
  }

  process.exitCode = state.failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
