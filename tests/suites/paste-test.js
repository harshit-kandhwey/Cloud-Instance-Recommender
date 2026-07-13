// Paste-from-spreadsheet: tab-separated text goes through the same pipeline as
// an upload — same column mapping, same unit handling, same hygiene check.
const { buildContext, makeChecker, rowsOf, headersOf } = require("./harness");

const { check, state } = makeChecker();
const rows = rowsOf;
const headers = headersOf;

// The stub only conjures an element once something asks for it by id, and
// renderPasteControl writes innerHTML rather than looking the textarea up — so
// ask for it here, the way a browser would already have it.
const textarea = (ctx) => ctx.document.getElementById("pasteInput");

// Paste `text` as if typed into the textarea, then press "Use this data".
function paste(ctx, _elements, text) {
  ctx.renderPasteControl();
  textarea(ctx).value = text;
  ctx.ingestPastedData();
}

const TAB = "	";

console.log("[a spreadsheet paste is tab-separated, and is read as such]");
{
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    [
      ["VM Name", "CPU Count", "Memory (GB)", "AWS Region"].join(TAB),
      ["web-01", "4", "16", "us-east-1"].join(TAB),
      ["db-02", "8", "32", "us-west-2"].join(TAB),
    ].join("\n"),
  );
  check("both rows load", rows(ctx).length === 2, JSON.stringify(rows(ctx)));
  check(
    "the columns are split on tabs, not swallowed into one",
    headers(ctx).length === 4 && rows(ctx)[0]["CPU Count"] === "4",
    JSON.stringify(rows(ctx)[0]),
  );
}

console.log("[a comma-separated paste still works]");
{
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    `VM Name,CPU Count,Memory (GB),AWS Region
web-01,4,16,us-east-1`,
  );
  check(
    "commas are read when there are no tabs",
    rows(ctx).length === 1 && rows(ctx)[0]["VM Name"] === "web-01",
    JSON.stringify(rows(ctx)),
  );
}

console.log("[a quoted field containing the delimiter survives]");
{
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    `VM Name,CPU Count,Memory (GB)
"srv-01, prod",4,16`,
  );
  check(
    "the comma inside quotes does not split the cell",
    rows(ctx)[0]["VM Name"] === "srv-01, prod",
    JSON.stringify(rows(ctx)[0]),
  );
}
{
  // The delimiter is decided by what actually DIVIDES the header. Two tabs
  // divide this one; the two commas are inside quoted cells and divide nothing.
  // Counting delimiters without regard to quotes sees 2 and 2, picks the comma,
  // and shreds every row in the file.
  //
  // The counts have to TIE (or favour the comma) for this to bite — an earlier
  // version of this fixture had two tabs and one comma, where naive counting
  // still lands on the tab and the test passes without testing anything.
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    [
      `"VM, display name"${TAB}"CPU, count"${TAB}Memory (GB)`,
      `"web-01, prod"${TAB}4${TAB}16`,
    ].join("\n"),
  );
  check(
    "quoted commas in the header do not turn a TSV into a CSV",
    headers(ctx).length === 3 &&
      rows(ctx)[0]["CPU Count"] === "4" &&
      rows(ctx)[0]["VM, display name"] === "web-01, prod",
    JSON.stringify({ headers: headers(ctx), row: rows(ctx)[0] }),
  );
}

console.log("[the paste goes through the SAME pipeline as an upload]");
{
  // Not canonical headers, and memory that looks like MiB with nothing in the
  // name to say so — the synonyms and the unit question must reach pasted rows
  // exactly as they reach a file's.
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    [
      ["Hostname", "vCPUs", "Memory (MB)"].join(TAB),
      ["web-01", "4", "16384"].join(TAB),
      ["db-02", "8", "65536"].join(TAB),
    ].join("\n"),
  );
  check(
    "synonyms are mapped (Hostname → VM Name, vCPUs → CPU Count)",
    rows(ctx)[0]["VM Name"] === "web-01" && rows(ctx)[0]["CPU Count"] === "4",
    JSON.stringify(rows(ctx)[0]),
  );
  check(
    "and a header that says MB is converted, as it would be from a file",
    rows(ctx)
      .map((r) => r["Memory (GB)"])
      .join(",") === "16,64",
    JSON.stringify(rows(ctx).map((r) => r["Memory (GB)"])),
  );
}
{
  // Same values, but nothing says MB. Pasted rows get the same question a file
  // would — and the same refusal to guess.
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    [
      ["Hostname", "vCPUs", "Memory"].join(TAB),
      ["web-01", "4", "16384"].join(TAB),
      ["db-02", "8", "65536"].join(TAB),
    ].join("\n"),
  );
  check(
    "an unlabelled MiB-looking column is questioned, not converted",
    rows(ctx)
      .map((r) => r["Memory (GB)"])
      .join(",") === "16384,65536" &&
      /Is the memory column in MB\?/.test(
        elements.inputHygieneSection.innerHTML,
      ),
    elements.inputHygieneSection.innerHTML,
  );
}

console.log("[the hygiene check runs on pasted rows too]");
{
  const { ctx, elements } = buildContext();
  paste(
    ctx,
    elements,
    [
      ["VM Name", "CPU Count", "Memory (GB)"].join(TAB),
      ["web-01", "4", "16"].join(TAB),
      ["broken", "0", "16"].join(TAB),
    ].join("\n"),
  );
  check(
    "a zero CPU count in a paste is reported, against row 3",
    !elements.inputHygieneSection.classes.has("hidden") &&
      /CPU count is missing or zero[^<]*1 row \(3\)/.test(
        elements.inputHygieneSection.innerHTML,
      ),
    elements.inputHygieneSection.innerHTML,
  );
}

console.log("[the classic paste mistakes are named, not swallowed]");
{
  const { ctx, elements, toasts } = buildContext();
  ctx.renderPasteControl();
  textarea(ctx).value = "   ";
  ctx.ingestPastedData();
  check(
    "an empty paste says so and loads nothing",
    rows(ctx).length === 0 &&
      toasts.some((t) => /Paste some rows first/.test(t.message)),
    JSON.stringify(toasts),
  );
}
{
  const { ctx, elements, toasts } = buildContext();
  // The header row was selected and the data underneath it was not — the single
  // most common way to get this wrong.
  paste(ctx, elements, ["VM Name", "CPU Count", "Memory (GB)"].join(TAB));
  check(
    "a header with no rows under it is called out",
    rows(ctx).length === 0 &&
      toasts.some((t) => /header row with no data under it/.test(t.message)),
    JSON.stringify(toasts),
  );
}

console.log("[a paste replaces the file, and says nothing stale]");
{
  const { ctx, elements } = buildContext();
  ctx.document.getElementById("csvFile").value = "old-inventory.csv";
  paste(
    ctx,
    elements,
    [
      ["VM Name", "CPU Count", "Memory (GB)"].join(TAB),
      ["web-01", "4", "16"].join(TAB),
    ].join("\n"),
  );
  check(
    "the previous file name is cleared, since it no longer describes the data",
    elements.csvFile.value === "",
    elements.csvFile.value,
  );
  check(
    "and the status says the data was pasted",
    /Pasted data loaded/.test(elements.fileStatus.innerHTML),
    elements.fileStatus.innerHTML,
  );
}

process.exit(state.failures ? 1 : 0);
