// Builds the validated input template: a ready-to-fill .xlsx whose ENV, OS,
// Workload and Criticality columns are dropdowns, so a typo in a closed-enum column
// is unselectable instead of the silent no-op it is in a CSV.
//
//   node scripts/testing/make-template.js           # write the committed artifact
//   node scripts/testing/make-template.js --check   # read-only; exit 1 if it is stale
//
// A script, not a runtime export, on purpose: the page ships no workbook writer that
// can emit data validation, and the artifact is a static file the page links to, so
// no library runs in the browser. The workbook is written by hand (sheet XML plus a
// STORE-only zip, Node built-ins only): STORE rather than DEFLATE so the bytes do not
// depend on the zlib version, which is what lets --check and the guard suite compare
// them exactly. The dropdown values are read from RuleEngine.RECOGNIZED, never copied.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
const TEMPLATE_PATH = path.join(
  REPO,
  "assets",
  "templates",
  "cloud_instance_recommender_template.xlsx",
);

const SHEET_INVENTORY = "Inventory";
const SHEET_VALUES = "Allowed values";
const SHEET_README = "Read me";

// Canonical input columns in authoring order: the sample CSV's, plus the per-row
// Include Only allow-list and the Criticality column.
const TEMPLATE_COLUMNS = [
  "VM Name",
  "App Name",
  "CPU Count",
  "Memory (GB)",
  "CPU Utilization",
  "Memory Utilization",
  "AWS Region",
  "Azure Region",
  "GCP Region",
  "ENV",
  "OS",
  "Workload",
  "Compliance",
  "Criticality",
  "AWS Min Gen",
  "Azure Min Gen",
  "GCP Min Gen",
  "Exclude",
  "Include Only",
  "Current Instance Type",
];

// Two example rows. Every closed-enum cell is a value the engine recognises; the
// second row shows a Compliance tag, a multi-token Exclude and an Include Only list.
const TEMPLATE_EXAMPLES = [
  {
    "VM Name": "web-server-01",
    "App Name": "Storefront",
    "CPU Count": 4,
    "Memory (GB)": 16,
    "CPU Utilization": 45,
    "Memory Utilization": 60,
    "AWS Region": "us-east-1",
    "Azure Region": "East US",
    "GCP Region": "us-central1-a",
    ENV: "Production",
    OS: "Linux",
    Workload: "Web Server",
    Criticality: "High",
    "Current Instance Type": "m5.xlarge",
  },
  {
    "VM Name": "db-server-02",
    "App Name": "Billing",
    "CPU Count": 8,
    "Memory (GB)": 32,
    "CPU Utilization": 70,
    "Memory Utilization": 80,
    "AWS Region": "us-west-2",
    "Azure Region": "West US 2",
    "GCP Region": "us-west1-b",
    ENV: "Production",
    OS: "Windows",
    Workload: "Database",
    Compliance: "PCI",
    Criticality: "Critical",
    "AWS Min Gen": "6",
    Exclude: "Burstable,GPU",
    "Include Only": "m5,m6",
    "Current Instance Type": "m5.2xlarge",
  },
];

// The columns that become dropdowns, and the RuleEngine.RECOGNIZED list each reads.
// Compliance is deliberately not here: it takes several comma-separated values, and a
// dropdown would refuse them.
const DROPDOWNS = [
  { column: "ENV", recognized: "env" },
  { column: "OS", recognized: "os" },
  { column: "Workload", recognized: "workload" },
  { column: "Criticality", recognized: "criticality" },
];

// Rows the dropdowns cover. Far beyond a typical inventory, and cheap: validation is
// one rule per column, not one per cell.
const FIRST_DATA_ROW = 2;
const LAST_VALIDATED_ROW = 50000;

// The header fill the results workbook uses, with white bold text.
const HEADER_FILL_ARGB = "FF4C63D2";

// cellXfs indexes in STYLES_XML.
const STYLE_HEADER = 1;
const STYLE_WRAP = 2;

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CONTENT_TYPES =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// The engine's recognised values, read from the rule engine's own source.
function loadRecognized() {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(REPO, "src/core/rules/rule-engine.js"), "utf8"),
    ctx,
    { filename: "rule-engine.js" },
  );
  return vm.runInContext("RuleEngine.RECOGNIZED", ctx);
}

// Values whose display form is not plain title case (acronyms and brand spellings).
const DISPLAY_OVERRIDES = {
  qa: "QA",
  macos: "macOS",
  "sql server": "SQL Server",
  sql: "SQL",
  sqlserver: "SQLServer",
  mssql: "MSSQL",
  "ml/ai": "ML/AI",
  ml: "ML",
  ai: "AI",
  gpu: "GPU",
  hpc: "HPC",
  sap: "SAP",
  nosql: "NoSQL",
  "ci/cd": "CI/CD",
};

// How a recognised value is shown in a dropdown. The engine matches case-insensitively,
// so display case is free; the guard suite compares values lower-cased.
function displayValue(raw) {
  const key = String(raw).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(DISPLAY_OVERRIDES, key)) {
    return DISPLAY_OVERRIDES[key];
  }
  return String(raw)
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 0-based column index to A1 letters (0 is A, 26 is AA).
function colLetter(index) {
  let s = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    s = String.fromCharCode(65 + (n % 26)) + s;
  }
  return s;
}

// A cell. Strings are written inline (no shared-strings part), numbers as numbers, and
// an empty value as no cell at all.
function cellXml(rowIndex, colIndex, value, style) {
  if (value === "" || value === undefined || value === null) return "";
  const ref = `${colLetter(colIndex)}${rowIndex + 1}`;
  const s = style ? ` s="${style}"` : "";
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

// One worksheet. `rows` is an array of rows; a cell is a bare value or { v, s }.
function sheetXml({ rows, widths, validations, freezeHeader }) {
  const lastCol = Math.max(widths.length, ...rows.map((r) => r.length)) - 1;
  const sheetData = rows
    .map((row, ri) => {
      const cells = row.map((cell, ci) => {
        const { v, s } =
          cell !== null && typeof cell === "object" ? cell : { v: cell, s: 0 };
        return cellXml(ri, ci, v, s);
      });
      return `<row r="${ri + 1}">${cells.join("")}</row>`;
    })
    .join("");
  const cols = widths
    .map(
      (w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
    )
    .join("");
  const pane = freezeHeader
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    : "";
  const dv = validations.length
    ? `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>`
    : "";
  return (
    XML_DECL +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<dimension ref="A1:${colLetter(lastCol)}${rows.length}"/>` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${sheetData}</sheetData>` +
    dv +
    "</worksheet>"
  );
}

// One list dropdown that reads its items from a range on the Allowed values sheet.
function listValidation({ sqref, formula, title }) {
  return (
    '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="stop"' +
    ` errorTitle="${xmlEscape(`Not a recognised ${title}`)}"` +
    ` error="${xmlEscape(`Pick a ${title} from the list, or leave the cell blank.`)}"` +
    ` promptTitle="${xmlEscape(title)}"` +
    ` prompt="${xmlEscape(`Pick a ${title} from the list, or leave blank to use the page default.`)}"` +
    ` sqref="${sqref}"><formula1>${xmlEscape(formula)}</formula1></dataValidation>`
  );
}

const STYLES_XML =
  XML_DECL +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  `<fill><patternFill patternType="solid"><fgColor rgb="${HEADER_FILL_ARGB}"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

// CRC-32 (IEEE), table-driven. zlib.crc32 only exists from Node 22, and CI runs 20.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// A zip of STORE entries with a fixed timestamp (1980-01-01 00:00), so the same input
// is always the same bytes.
function zipStore(entries) {
  const DOS_TIME = 0;
  const DOS_DATE = (1 << 5) | 1;
  const UTF8_NAMES = 0x0800;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const body = Buffer.from(data, "utf8");
    const crc = crc32(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

// The lists the dropdowns read (one column each, headers in row 1), plus notes for the
// free-text columns. Returns the sheet XML and each dropdown's A1 range.
function allowedValuesSheet(recognized) {
  const lists = DROPDOWNS.map(({ column, recognized: key }) => {
    const values = (recognized[key] || []).map(displayValue);
    // An empty list would make an inverted range and a dropdown with nothing to pick:
    // better to fail the build than to ship it.
    if (!values.length) {
      throw new Error(`The rule engine recognises no ${column} values`);
    }
    return { column, values };
  });
  const ranges = {};
  lists.forEach(({ column, values }, i) => {
    const letter = colLetter(i);
    ranges[column] = `$${letter}$2:$${letter}$${values.length + 1}`;
  });
  const notes = [
    [
      "Compliance",
      `Comma-separated, any case. Recognised: ${(recognized.compliance || []).join(", ")}.`,
    ],
    [
      "Exclude / Include Only",
      "Family names (m5, c5) or classifiers: burstable, graviton, gpu, fpga, mac, previous generation. Comma-separated.",
    ],
    [
      "Min Gen (per provider)",
      "Generation floor, native to each cloud: AWS a family generation number (6 keeps m6/c6/r6 and newer), Azure a v-number (4 keeps v4 and newer), GCP a family name (n4). Give the bare number for AWS and Azure.",
    ],
  ];
  const height = Math.max(notes.length, ...lists.map((l) => l.values.length));
  const rows = [
    [
      ...lists.map((l) => ({ v: l.column, s: STYLE_HEADER })),
      "",
      { v: "Column", s: STYLE_HEADER },
      { v: "Notes for the free-text columns", s: STYLE_HEADER },
    ],
  ];
  for (let i = 0; i < height; i++) {
    const row = lists.map((l) => (i < l.values.length ? l.values[i] : ""));
    row.push("");
    const note = notes[i];
    row.push(note ? { v: note[0], s: STYLE_WRAP } : "");
    row.push(note ? { v: note[1], s: STYLE_WRAP } : "");
    rows.push(row);
  }
  return {
    ranges,
    xml: sheetXml({
      rows,
      widths: [...lists.map(() => 22), 3, 26, 90],
      validations: [],
      freezeHeader: true,
    }),
  };
}

function inventorySheet(ranges) {
  const rows = [TEMPLATE_COLUMNS.map((c) => ({ v: c, s: STYLE_HEADER }))];
  for (const example of TEMPLATE_EXAMPLES) {
    rows.push(TEMPLATE_COLUMNS.map((c) => (c in example ? example[c] : "")));
  }
  const validations = DROPDOWNS.map(({ column }) => {
    const letter = colLetter(TEMPLATE_COLUMNS.indexOf(column));
    return listValidation({
      sqref: `${letter}${FIRST_DATA_ROW}:${letter}${LAST_VALIDATED_ROW}`,
      formula: `'${SHEET_VALUES}'!${ranges[column]}`,
      title: column,
    });
  });
  return sheetXml({
    rows,
    widths: TEMPLATE_COLUMNS.map((h) => Math.max(12, h.length + 2)),
    validations,
    freezeHeader: true,
  });
}

function readmeSheet() {
  const lines = [
    "Fill the Inventory sheet and upload it on any tool page.",
    "ENV, OS, Workload and Criticality are dropdowns: pick a value from the list, or leave the cell blank to use the page default. The lists are on the Allowed values sheet.",
    "Compliance, Exclude, Include Only and the Min Gen columns take free text; see the notes on the Allowed values sheet.",
    "CPU Count and Memory (GB) are required. Utilization columns are percentages from 0 to 100.",
    "The two example rows can be overwritten or deleted.",
  ];
  const rows = lines.map((line) => [{ v: line, s: STYLE_WRAP }]);
  return sheetXml({
    rows,
    widths: [110],
    validations: [],
    freezeHeader: false,
  });
}

// The whole workbook as a Buffer. Deterministic: the same inputs give the same bytes.
function buildTemplate(recognized = loadRecognized()) {
  const allowed = allowedValuesSheet(recognized);
  const sheets = [
    { name: SHEET_INVENTORY, xml: inventorySheet(allowed.ranges) },
    { name: SHEET_VALUES, xml: allowed.xml },
    { name: SHEET_README, xml: readmeSheet() },
  ];
  const worksheetType =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
  const contentTypes =
    XML_DECL +
    `<Types xmlns="${NS_CONTENT_TYPES}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${worksheetType}"/>`,
      )
      .join("") +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>";
  const rootRels =
    XML_DECL +
    `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook =
    XML_DECL +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView/></bookViews><sheets>` +
    sheets
      .map(
        (s, i) =>
          `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("") +
    "</sheets></workbook>";
  const workbookRels =
    XML_DECL +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
    "</Relationships>";
  return zipStore([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { name: "xl/styles.xml", data: STYLES_XML },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: s.xml,
    })),
  ]);
}

// Writes the artifact, or with --check compares it. Returns the process exit code.
function main(argv, target = TEMPLATE_PATH) {
  const built = buildTemplate();
  if (argv.includes("--check")) {
    const onDisk = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if (onDisk && onDisk.equals(built)) {
      console.log("The input template is up to date.");
      return 0;
    }
    console.error(
      "The committed input template is stale or missing. Run: node scripts/testing/make-template.js",
    );
    return 1;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, built);
  console.log(`Wrote ${path.relative(REPO, target)} (${built.length} bytes)`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  buildTemplate,
  main,
  TEMPLATE_PATH,
  TEMPLATE_COLUMNS,
  TEMPLATE_EXAMPLES,
  DROPDOWNS,
  displayValue,
  loadRecognized,
};
