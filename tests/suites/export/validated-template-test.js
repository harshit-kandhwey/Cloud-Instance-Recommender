// The validated input template (3.21 phase 8): a committed .xlsx whose ENV, OS,
// Workload and Criticality columns are dropdowns. A dropdown the engine ignores is
// worse than free text, because the user trusts it, so this suite pins:
//   1. the committed file is exactly what the generator builds now (never stale);
//   2. it is a well-formed zip, and reads back through the vendored reader;
//   3. each dropdown offers EXACTLY the engine's recognised values for its column,
//      and no other column is validated (Compliance takes several values);
//   4. the examples, the columns and the Min Gen floor are things the engine honours;
//   5. a hostile or empty vocabulary cannot produce a broken file, and the stale
//      check itself works.
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const { REPO, makeChecker } = require("../harness");
const gen = require(path.join(REPO, "scripts/testing/make-template.js"));

const { check, state } = makeChecker();

const recognized = gen.loadRecognized();
const committed = fs.existsSync(gen.TEMPLATE_PATH)
  ? fs.readFileSync(gen.TEMPLATE_PATH)
  : Buffer.alloc(0);

// ── helpers: an independent zip reader and tiny XML readers ──────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) return null;
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const start =
      lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    entries[name] = { method, crc, data, ok: crc32(data) === crc };
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

// Cells of a sheet as { "A1": value } (inline strings and numbers).
function cellsOf(xml) {
  const out = {};
  const re =
    /<c r="([A-Z]+\d+)"[^>]*?>(?:<is><t[^>]*>([^<]*)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>/g;
  let m;
  while ((m = re.exec(xml)))
    out[m[1]] = unescapeXml(m[2] !== undefined ? m[2] : m[3]);
  return out;
}

function validationsOf(xml) {
  const out = [];
  const re =
    /<dataValidation ([^>]*)><formula1>([^<]*)<\/formula1><\/dataValidation>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    m[1].replace(/(\w+)="([^"]*)"/g, (_, k, v) => (attrs[k] = unescapeXml(v)));
    out.push({ attrs, formula: unescapeXml(m[2]) });
  }
  return out;
}

const text = (zip, name) => zip[name].data.toString("utf8");
const letterOf = (i) => String.fromCharCode(65 + i); // enough for the first 26 columns

// ── 1. the committed file is what the generator builds now ───────────────────
console.log("[the committed template is never stale]");
{
  check(
    "the committed file exists",
    committed.length > 0,
    "run: node scripts/testing/make-template.js",
  );
  check(
    "it is byte-for-byte what the generator builds from the engine's vocabularies",
    committed.equals(gen.buildTemplate()),
    "stale: run node scripts/testing/make-template.js and commit the result",
  );
  check(
    "building twice gives the same bytes (nothing time- or order-dependent)",
    gen.buildTemplate().equals(gen.buildTemplate()),
  );
}

// ── 2. a well-formed zip ─────────────────────────────────────────────────────
console.log("[it is a well-formed workbook package]");
const zip = readZip(committed) || {};
{
  const names = Object.keys(zip);
  check(
    "the package has every part a workbook needs",
    [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/sheet3.xml",
    ].every((n) => names.includes(n)),
    names.join(", "),
  );
  check(
    "every entry's CRC-32 matches its data",
    names.length > 0 && names.every((n) => zip[n].ok),
    names.filter((n) => !zip[n].ok).join(", "),
  );
  check(
    "entries are stored, not compressed, so the bytes do not depend on the zlib version",
    names.every((n) => zip[n].method === 0),
  );
  check(
    "the content-types part lists the three worksheets and the styles",
    (text(zip, "[Content_Types].xml").match(/worksheet\+xml/g) || []).length ===
      3 && text(zip, "[Content_Types].xml").includes("styles+xml"),
  );
  const wb = text(zip, "xl/workbook.xml");
  check(
    "the sheets are Inventory, Allowed values and Read me, in that order",
    /name="Inventory"[^>]*\/>.*name="Allowed values"[^>]*\/>.*name="Read me"/.test(
      wb,
    ),
    wb,
  );
}

// ── 3. each dropdown offers exactly the engine's values ──────────────────────
console.log("[each dropdown offers exactly the engine's recognised values]");
const inv = zip["xl/worksheets/sheet1.xml"]
  ? text(zip, "xl/worksheets/sheet1.xml")
  : "";
const invCells = cellsOf(inv);
const valuesSheet = zip["xl/worksheets/sheet2.xml"]
  ? text(zip, "xl/worksheets/sheet2.xml")
  : "";
const valuesCells = cellsOf(valuesSheet);
{
  const headers = gen.TEMPLATE_COLUMNS.map(
    (_, i) => invCells[`${letterOf(i)}1`],
  );
  check(
    "the Inventory header row is the template's canonical column list",
    JSON.stringify(headers) === JSON.stringify(gen.TEMPLATE_COLUMNS),
    JSON.stringify(headers),
  );

  const validations = validationsOf(inv);
  const byColumn = {};
  for (const v of validations) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(v.attrs.sqref || "");
    if (!m || m[1] !== m[3]) continue;
    const idx = m[1].charCodeAt(0) - 65;
    byColumn[headers[idx]] = { v, firstRow: +m[2], lastRow: +m[4] };
  }
  check(
    "exactly ENV, OS, Workload and Criticality are validated; Compliance and the rest are free text",
    JSON.stringify(Object.keys(byColumn).sort()) ===
      JSON.stringify(["Criticality", "ENV", "OS", "Workload"]) &&
      validations.length === 4,
    JSON.stringify(Object.keys(byColumn)),
  );
  check(
    "every rule is a list that blocks a bad value but allows a blank, from row 2 down",
    Object.values(byColumn).every(
      ({ v, firstRow }) =>
        v.attrs.type === "list" &&
        v.attrs.errorStyle === "stop" &&
        v.attrs.showErrorMessage === "1" &&
        v.attrs.allowBlank === "1" &&
        firstRow === 2,
    ),
  );
  check(
    "the rules reach far past a typical inventory",
    Object.values(byColumn).every(({ lastRow }) => lastRow >= 10000),
  );

  for (const { column, recognized: key } of gen.DROPDOWNS) {
    const rule = byColumn[column];
    const m =
      rule &&
      /^'Allowed values'!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)$/.exec(
        rule.v.formula,
      );
    check(
      `${column}: the list reads a range on the Allowed values sheet`,
      !!m && m[1] === m[3],
      rule && rule.v.formula,
    );
    if (!m) continue;
    const letter = m[1];
    const from = +m[2];
    const to = +m[4];
    const offered = [];
    for (let r = from; r <= to; r++) offered.push(valuesCells[`${letter}${r}`]);
    check(
      `${column}: the range holds exactly the engine's ${key} values, none blank or extra`,
      JSON.stringify(offered.map((v) => String(v).toLowerCase())) ===
        JSON.stringify(recognized[key].map((v) => v.toLowerCase())),
      JSON.stringify(offered),
    );
    check(
      `${column}: the header above the list names the column`,
      valuesCells[`${letter}1`] === column && from === 2,
      valuesCells[`${letter}1`],
    );
    check(
      `${column}: nothing is listed below the range that a longer list would have offered`,
      valuesCells[`${letter}${to + 1}`] === undefined,
    );
  }
}

// ── 4. the examples and the columns are things the engine honours ────────────
console.log("[the examples never demonstrate a value the engine ignores]");
{
  const lower = (list) => list.map((v) => v.toLowerCase());
  const offenders = [];
  gen.TEMPLATE_EXAMPLES.forEach((ex, i) => {
    for (const { column, recognized: key } of gen.DROPDOWNS) {
      const raw = String(ex[column] ?? "").trim();
      if (raw && !lower(recognized[key]).includes(raw.toLowerCase())) {
        offenders.push(`row ${i}: ${column}="${raw}"`);
      }
    }
    for (const token of String(ex.Compliance || "").split(",")) {
      const t = token.trim();
      if (t && !lower(recognized.compliance).includes(t.toLowerCase())) {
        offenders.push(`row ${i}: Compliance="${t}"`);
      }
    }
  });
  check(
    "every closed-enum example value is recognised",
    offenders.length === 0,
    offenders.join("; "),
  );

  // The cells in the file are the examples, in the columns the dropdowns guard.
  const filled = gen.TEMPLATE_EXAMPLES.every((ex, r) =>
    gen.DROPDOWNS.every(({ column }) => {
      const cell = `${letterOf(gen.TEMPLATE_COLUMNS.indexOf(column))}${r + 2}`;
      return (invCells[cell] || "") === String(ex[column] ?? "");
    }),
  );
  check("the example rows in the file carry those values", filled);

  const ingestSrc = fs.readFileSync(
    path.join(REPO, "src/features/ingest.js"),
    "utf8",
  );
  const headerLine =
    (ingestSrc.match(/const csvContent = `([^\n]*)/) || [])[1] || "";
  const sample = headerLine.split(",").map((s) => s.trim());
  const expected = new Set([...sample, "Include Only", "Criticality"]);
  const got = new Set(gen.TEMPLATE_COLUMNS);
  check(
    "the columns are the sample CSV's plus Include Only and Criticality",
    [...expected].every((c) => got.has(c)) &&
      [...got].every((c) => expected.has(c)),
    `sample: ${headerLine}`,
  );
  check(
    "the columns the app maps by name are all canonical column names",
    gen.TEMPLATE_COLUMNS.every((c) => typeof c === "string" && c === c.trim()),
  );

  // Min Gen is an open token set, so the enum check above cannot see it. A prefixed
  // value like "m6" parses to NaN and disables the floor silently, so prove the
  // example floor actually filters.
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(REPO, "src/core/rules/rule-engine.js"), "utf8"),
    ctx,
  );
  const mmg = vm.runInContext("RuleEngine.meetsMinGeneration", ctx);
  const floor = gen.TEMPLATE_EXAMPLES.map((e) => e["AWS Min Gen"]).find(
    Boolean,
  );
  check(
    "the example AWS Min Gen is a floor the engine applies: it drops m5 and keeps m6i",
    !!floor &&
      mmg({ instanceType: "m5.large", family: "m5" }, floor, "aws") === false &&
      mmg({ instanceType: "m6i.large", family: "m6i" }, floor, "aws") === true,
    String(floor),
  );
}

// ── 5. it reads back through the vendored reader ─────────────────────────────
console.log("[the vendored reader opens it and sees the same data]");
{
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    document: { createElement: () => ({}), head: { appendChild() {} } },
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(REPO, "js/vendor/xlsx.full.min.js"), "utf8"),
    ctx,
  );
  ctx.__b64 = committed.toString("base64");
  const names = vm.runInContext(
    'XLSX.read(__b64, { type: "base64" }).SheetNames',
    ctx,
  );
  check(
    "it opens, with the three sheets",
    JSON.stringify(names) ===
      JSON.stringify(["Inventory", "Allowed values", "Read me"]),
    JSON.stringify(names),
  );
  const rows = vm.runInContext(
    'XLSX.utils.sheet_to_json(XLSX.read(__b64, { type: "base64" }).Sheets.Inventory, { header: 1 })',
    ctx,
  );
  check(
    "its Inventory header row and example count are the template's",
    JSON.stringify(rows[0]) === JSON.stringify(gen.TEMPLATE_COLUMNS) &&
      rows.length === gen.TEMPLATE_EXAMPLES.length + 1,
    JSON.stringify(rows[0]),
  );
  const first = rows[1] || [];
  check(
    "the first example's numbers read back as numbers, not text",
    first[gen.TEMPLATE_COLUMNS.indexOf("CPU Count")] === 4 &&
      first[gen.TEMPLATE_COLUMNS.indexOf("Memory (GB)")] === 16,
    JSON.stringify(first),
  );
  const notes = vm.runInContext(
    'JSON.stringify(XLSX.utils.sheet_to_json(XLSX.read(__b64, { type: "base64" }).Sheets["Allowed values"], { header: 1 }))',
    ctx,
  );
  check(
    "the notes for the free-text columns are present",
    notes.includes("Compliance") && notes.includes("Min Gen"),
  );
}

// ── 6. hostile and empty vocabularies, and the stale check ───────────────────
console.log("[a hostile or empty vocabulary cannot produce a broken file]");
{
  const hostile = gen.buildTemplate({
    env: ['x&<>"y'],
    os: ["linux"],
    workload: ["database"],
    criticality: ["high"],
    compliance: ["pci&<"],
  });
  const z = readZip(hostile) || {};
  const sheet2 = z["xl/worksheets/sheet2.xml"]
    ? text(z, "xl/worksheets/sheet2.xml")
    : "";
  check(
    "markup in a value is escaped in the sheet XML, never inserted",
    sheet2.includes("X&amp;&lt;&gt;&quot;y") &&
      !/<t[^>]*>[^<]*<[a-z]/i.test(
        sheet2.replace(/<\/?(t|is|c|row|v)[ >][^>]*>?/g, ""),
      ),
    sheet2.slice(0, 400),
  );
  check(
    "a one-value list still gets a valid one-cell range",
    validationsOf(text(z, "xl/worksheets/sheet1.xml")).some((v) =>
      /\$A\$2:\$A\$2$/.test(v.formula),
    ),
  );
  let threw = "";
  try {
    gen.buildTemplate({
      env: [],
      os: ["linux"],
      workload: ["a"],
      criticality: ["high"],
      compliance: [],
    });
  } catch (e) {
    threw = String(e && e.message);
  }
  check(
    "an empty list fails the build instead of shipping a dropdown with nothing to pick",
    threw.includes("recognises no ENV values"),
    threw,
  );
}

console.log("[the --check mode tells a stale file from a fresh one]");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cir-template-"));
  const target = path.join(dir, "template.xlsx");
  const quiet = (fn) => {
    const log = console.log;
    const err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      return fn();
    } finally {
      console.log = log;
      console.error = err;
    }
  };
  try {
    check(
      "a missing file fails the check",
      quiet(() => gen.main(["--check"], target)) === 1,
    );
    check(
      "writing creates it, byte-for-byte what the generator builds",
      quiet(() => gen.main([], target)) === 0 &&
        fs.readFileSync(target).equals(gen.buildTemplate()),
    );
    check(
      "and then the check passes",
      quiet(() => gen.main(["--check"], target)) === 0,
    );
    const bytes = fs.readFileSync(target);
    bytes[bytes.length - 30] ^= 0xff;
    fs.writeFileSync(target, bytes);
    check(
      "one flipped byte makes the check fail",
      quiet(() => gen.main(["--check"], target)) === 1,
    );
  } finally {
    if (fs.existsSync(target)) fs.unlinkSync(target);
    fs.rmdirSync(dir);
  }
}

console.log("[display names]");
{
  const cases = {
    production: "Production",
    qa: "QA",
    macos: "macOS",
    "windows server": "Windows Server",
    "sql server": "SQL Server",
    "ml/ai": "ML/AI",
    nosql: "NoSQL",
    "ci/cd": "CI/CD",
    "big data": "Big Data",
  };
  check(
    "acronyms and brand spellings read correctly, the rest are title case",
    Object.entries(cases).every(
      ([raw, shown]) => gen.displayValue(raw) === shown,
    ),
    JSON.stringify(
      Object.entries(cases).filter(([r, s]) => gen.displayValue(r) !== s),
    ),
  );
}

process.exitCode = state.failures ? 1 : 0;
