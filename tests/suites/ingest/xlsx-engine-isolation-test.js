// Which SheetJS build parses an upload is a SECURITY property, not a detail.
//
// Two bundles are vendored and BOTH define window.XLSX, and both expose read():
//   js/vendor/xlsx.full.min.js      0.20.3  — the parser
//   js/vendor/xlsx-js-style.min.js  0.18.5  — the styling fork, used to WRITE
//
// The fork is SheetJS 0.18.x, so it predates the read-path fixes for
// CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS). Whichever
// bundle loads last owns window.XLSX, so reading through the bare global made
// the engine depend on click order:
//
//   upload CSV → generate → Download Results (Excel)  [loads the 0.18.5 fork]
//                         → upload an .xlsx           [parsed by 0.18.5]
//
// The two bundles are separate objects, so each path captures its own:
// window._xlsxParser is always the full build, window._xlsxWriter the styler.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..", "..");
const FULL = "js/vendor/xlsx.full.min.js";
const FORK = "js/vendor/xlsx-js-style.min.js";

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
};

// A context that can "load" a vendored bundle the way a <script> tag would.
function newPage() {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  const loadBundle = (rel) =>
    vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
      filename: rel,
    });
  return { sandbox, ctx, loadBundle };
}

console.log("[the two vendored bundles really do collide on window.XLSX]");
{
  // If this ever stops being true the isolation below is unnecessary — but it
  // is true today, and it is the whole reason the rest of this suite exists.
  const { sandbox, loadBundle } = newPage();
  loadBundle(FULL);
  const fullVersion = sandbox.XLSX.version;
  loadBundle(FORK);
  const afterFork = sandbox.XLSX.version;
  check(
    "both define window.XLSX, and the fork overwrites the full build",
    fullVersion === "0.20.3" && afterFork === "0.18.5",
    `full=${fullVersion} afterFork=${afterFork}`,
  );
  check(
    "and the fork is the older, unpatched line",
    afterFork.startsWith("0.18."),
    afterFork,
  );
}

console.log("[the read path is pinned to the patched full build]");
{
  const src = fs.readFileSync(path.join(REPO, "js/base/ingest.js"), "utf8");
  check(
    "ensureXlsxLoaded does not accept whatever window.XLSX happens to be",
    !/if\s*\(\s*window\.XLSX\s*\)\s*return\s+Promise\.resolve\(\)/.test(src),
    "the guard still short-circuits on the bare global — the fork would satisfy it",
  );
  check(
    "it guards on the captured parser instead",
    /if\s*\(\s*window\._xlsxParser\s*\)\s*return\s+Promise\.resolve\(\)/.test(
      src,
    ),
  );
  check(
    "the parser reference is captured from the FULL build's own load",
    /xlsx\.full\.min\.js[\s\S]*?window\._xlsxParser\s*=\s*window\.XLSX/.test(
      src,
    ),
  );
  // The actual reads must not go through the global.
  check(
    "workbook parsing reads through the captured parser",
    /window\._xlsxParser\.read\(/.test(src) && !/\bXLSX\.read\(/.test(src),
    "a bare XLSX.read( remains — it would use whichever build loaded last",
  );
  check(
    "sheet extraction reads through the captured parser",
    /window\._xlsxParser\.utils\.sheet_to_json\(/.test(src) &&
      !/[^_]\bXLSX\.utils\.sheet_to_json\(/.test(src),
    "a bare XLSX.utils.sheet_to_json( remains",
  );
}

console.log("[the write paths are pinned to their own engine]");
{
  // The mirror hazard: an .xlsx upload loads the full build and overwrites
  // window.XLSX, which cannot style — so an export reading the bare global
  // would silently lose its formatting.
  for (const f of ["js/base/xlsx-export.js", "js/base/portfolio.js"]) {
    const src = fs.readFileSync(path.join(REPO, f), "utf8");
    const name = path.basename(f);
    check(
      `${name} captures the engine it loaded`,
      /window\._xlsxWriter\s*=\s*window\.XLSX/.test(src),
    );
    check(
      `${name} writes through the captured engine, not the bare global`,
      !/window\.XLSX\.writeFile\(/.test(src) && /writeFile\(/.test(src),
      "window.XLSX.writeFile( remains — it may be the unstyled parser",
    );
  }
}

console.log("[load order cannot cross the two engines]");
{
  // Simulate the reachable flow end to end: export first (fork), then upload
  // (full). Each side must still hold the engine it needs.
  const { sandbox, loadBundle } = newPage();

  // 1. Export runs first — loads the styling fork and captures it.
  loadBundle(FORK);
  sandbox.window._xlsxWriter = sandbox.XLSX;

  // 2. Then an .xlsx upload loads the full build and captures it as the parser.
  loadBundle(FULL);
  sandbox.window._xlsxParser = sandbox.XLSX;

  check(
    "the parser is the patched full build",
    sandbox.window._xlsxParser.version === "0.20.3",
    `parser = ${sandbox.window._xlsxParser.version}`,
  );
  check(
    "the writer is still the styling fork",
    sandbox.window._xlsxWriter.version === "0.18.5" &&
      sandbox.window._xlsxWriter.style_version != null,
    `writer = ${sandbox.window._xlsxWriter.version}`,
  );
  check(
    "they are distinct objects, so neither clobbers the other",
    sandbox.window._xlsxParser !== sandbox.window._xlsxWriter,
  );
  // And the reverse order (upload first, then export) is equally safe.
  const p2 = newPage();
  p2.loadBundle(FULL);
  p2.sandbox.window._xlsxParser = p2.sandbox.XLSX;
  p2.loadBundle(FORK);
  p2.sandbox.window._xlsxWriter = p2.sandbox.XLSX;
  check(
    "upload-then-export keeps the same split",
    p2.sandbox.window._xlsxParser.version === "0.20.3" &&
      p2.sandbox.window._xlsxWriter.style_version != null,
    `parser=${p2.sandbox.window._xlsxParser.version} writer=${p2.sandbox.window._xlsxWriter.version}`,
  );
}

process.exit(failures ? 1 : 0);
