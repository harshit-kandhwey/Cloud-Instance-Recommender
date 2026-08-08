// Quoted fields with embedded newlines (RFC-4180) must NOT split a record.
// parseDelimitedText used to `.split("\n")` BEFORE any quote awareness, then
// parse each "line" with the quote-aware parseCSVLine — so a quoted cell
// carrying a newline was torn across records, misaligning every field after it.
// The care taken for quoted COMMAS (sniffDelimiter / parseCSVLine) meant nothing
// once the line split had already shredded the record. The fix makes the record
// SPLIT itself quote-aware (splitRecords), so a newline inside quotes is data,
// not a boundary.
//
// Domain inputs (RVTools / Azure Migrate / ADS) don't emit embedded newlines, so
// this is a correctness-hardening case, not a live data bug — but a hand-authored
// notes/description cell hits it, and the parser now reads it faithfully.
const vm = require("vm");
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const { ctx } = buildContext();
const parseDelimited = (text) =>
  vm.runInContext(`parseDelimitedText(${JSON.stringify(text)})`, ctx);

console.log("[a quoted newline stays inside one record]");
{
  // One logical row: VM=web-01, Notes="line1\nline2", CPU=4. The old line-split
  // produced TWO rows here and dropped CPU alignment.
  const { headers, rows } = parseDelimited(
    'VM,Notes,CPU\nweb-01,"line1\nline2",4',
  );
  check(
    "the header row is read as three columns",
    headers.length === 3 && headers[1] === "Notes",
    JSON.stringify(headers),
  );
  check(
    "the embedded newline does not create a second data row",
    rows.length === 1,
    `rows.length=${rows.length}`,
  );
  const row = rows[0] || {};
  check(
    "the quoted cell keeps both lines under one key",
    row["Notes"] === "line1\nline2",
    JSON.stringify(row["Notes"]),
  );
  check(
    "the column AFTER the multi-line cell stays aligned",
    String(row["CPU"]) === "4",
    JSON.stringify(row),
  );
}

console.log("[a quoted newline alongside a quoted comma and doubled quotes]");
{
  // The multi-line cell also carries the delimiter and an escaped quote, so the
  // record splitter and parseCSVLine must agree on quote state end to end.
  const { rows } = parseDelimited(
    'VM,Notes,CPU\nweb-02,"a, b\n""c""",8\nweb-03,plain,2',
  );
  check(
    "two data rows, not four",
    rows.length === 2,
    `rows.length=${rows.length}`,
  );
  check(
    "the comma inside the quoted multi-line cell is not a field boundary",
    (rows[0] || {})["Notes"] === 'a, b\n"c"',
    JSON.stringify((rows[0] || {})["Notes"]),
  );
  check(
    "the row after the multi-line record is read whole",
    String((rows[1] || {})["CPU"]) === "2" &&
      (rows[1] || {})["Notes"] === "plain",
    JSON.stringify(rows[1]),
  );
}

console.log("[CRLF line endings around a quoted newline]");
{
  // Windows exports use \r\n between records; the newline INSIDE the quotes may
  // itself be \r\n. Record boundaries normalize; the in-cell newline is kept.
  const { rows } = parseDelimited(
    'VM,Notes,CPU\r\nweb-04,"x\r\ny",1\r\nweb-05,z,3',
  );
  check(
    "CRLF between records still yields two rows",
    rows.length === 2,
    `rows.length=${rows.length}`,
  );
  check(
    "the in-cell CRLF is normalized and kept as one newline",
    (rows[0] || {})["Notes"] === "x\ny",
    JSON.stringify((rows[0] || {})["Notes"]),
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout when
// it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;
