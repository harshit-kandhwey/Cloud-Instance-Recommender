// The four tool pages (aws/azure/gcp/multicloud) share one app shell and one set
// of js/base modules. Those modules look elements up by id, so a page that
// quietly loses a placeholder does not throw — every shared renderer is written
// to survive its element being absent — it just silently stops offering that
// feature on that page. gcp.html once sat a whole release showing a sample the
// download never produced, for exactly this reason: nothing compared the pages.
//
// This suite compares them. Divergences are allowed, but only DELIBERATE ones:
// each is listed below with its reason, so adding a control to one page and
// forgetting the other three goes red instead of shipping.
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..", "..");
const PAGES = ["aws.html", "azure.html", "gcp.html", "multicloud.html"];

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
};

// Raw text matching would accept an id that only appears inside a comment or a
// script string, so a placeholder could be commented out and this suite would
// still call the page compliant. Drop the non-markup parts first (same approach
// as accessibility-affordances-test.js) and require the id on a real element.
const stripNonMarkup = (src) =>
  src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");

// raw keeps the <script src> tags the module-order check below reads; html is
// the stripped view everything else matches against.
const raw = Object.fromEntries(
  PAGES.map((p) => [p, fs.readFileSync(path.join(REPO, p), "utf8")]),
);
const html = Object.fromEntries(PAGES.map((p) => [p, stripNonMarkup(raw[p])]));
const short = (p) => p.replace(".html", "");

// An id is "present" only when it sits on an element tag, not merely in the text.
// The separator must be whitespace, NOT \b: a word boundary also fires at the
// hyphen→i transition inside data-id=, aria-*-id=, and this repo's own
// data-section-id=, so \bid=" would accept a page that carries
// data-section-id="downloadBtnsRow" as if it had the real element. That is the
// false positive this whole helper exists to prevent — it would report a
// placeholder present on a page that never renders it, and the parity check
// would then either pass a genuine divergence or, when the id is in INTENTIONAL,
// stop verifying that divergence at all.
const hasElementId = (page, id) =>
  new RegExp(`<[a-zA-Z][^>]*\\sid=["']${id}["']`, "i").test(html[page]);

// ─── Deliberate divergences ──────────────────────────────────────────────────
// id → the pages that are SUPPOSED to carry it, and why.
const INTENTIONAL = {
  // The AWS Pricing Calculator bulk template is an AWS-only artifact; the
  // consumer (updateDownloadButtons) returns early when the row is absent.
  downloadBtnsRow: ["aws.html"],
  // MinGen is native to one cloud, so a single-provider page has one control
  // and the multi-cloud page has three — one per provider — rather than a
  // cross-provider scale that would have to be translated.
  ruleDefaultMinGen: ["aws.html", "azure.html", "gcp.html"],
  ruleDefaultMinGenAws: ["multicloud.html"],
  ruleDefaultMinGenAzure: ["multicloud.html"],
  ruleDefaultMinGenGcp: ["multicloud.html"],
};

// ─── Every js/base lookup is on every page, or deliberately not ──────────────
console.log("[shared modules find their elements on every page]");
{
  const baseDir = path.join(REPO, "js", "base");
  const js = fs
    .readdirSync(baseDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(baseDir, f), "utf8"))
    .join("\n");

  const lookedUp = [
    ...new Set(
      [...js.matchAll(/getElementById\(\s*["']([A-Za-z][\w-]*)["']\s*\)/g)].map(
        (m) => m[1],
      ),
    ),
  ];
  // Ids the shared JS renders itself never need to exist in the page markup.
  const generated = new Set(
    [...js.matchAll(/id="([A-Za-z][\w-]*)"/g)].map((m) => m[1]),
  );

  check(
    "the scan found the shared lookups (guards against a broken regex)",
    lookedUp.length > 50,
    `only ${lookedUp.length} lookups found — the scan is probably not matching`,
  );

  const unexplained = [];
  for (const id of lookedUp) {
    if (generated.has(id)) continue;
    const present = PAGES.filter((p) => hasElementId(p, id));
    if (present.length === 0 || present.length === PAGES.length) continue;
    const expected = INTENTIONAL[id];
    if (
      expected &&
      expected.slice().sort().join() === present.slice().sort().join()
    ) {
      continue;
    }
    unexplained.push(
      `${id}: on [${present.map(short)}]` +
        (expected
          ? ` but expected [${expected.map(short)}]`
          : " — not in the deliberate list"),
    );
  }
  check(
    "every partial-presence id is a documented, deliberate divergence",
    unexplained.length === 0,
    unexplained.join("\n        "),
  );
}

// ─── The shared shell loads the same modules, in the same order ──────────────
console.log("[every page loads the same js/base modules in the same order]");
{
  const baseScripts = (p) =>
    [...raw[p].matchAll(/<script[^>]+src="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((s) => s.includes("/base/"));
  const ref = baseScripts(PAGES[0]);
  check(
    "the reference page loads a full module set",
    ref.length > 10,
    `only ${ref.length} base scripts on ${PAGES[0]}`,
  );
  PAGES.slice(1).forEach((p) => {
    const got = baseScripts(p);
    check(
      `${short(p)} matches ${short(PAGES[0])}`,
      got.join("|") === ref.join("|"),
      `missing: [${ref.filter((s) => !got.includes(s))}] extra: [${got.filter((s) => !ref.includes(s))}]`,
    );
  });
}

// ─── The shared feature surfaces exist everywhere ────────────────────────────
// Named markers rather than ids, so this also covers buttons wired by onclick.
console.log("[every page offers the same shared features]");
{
  const MARKERS = {
    "Excel download (primary)": "downloadResultsXlsxBtn",
    "CSV multiselect dropdown": 'id="csvMenu"',
    "Print report": "printExecutiveReport()",
    "Executive report target": 'id="executiveReportSection"',
    "Results charts": 'id="resultsChartsSection"',
    "App Portfolio": "openAppPortfolioBtn",
    "Scenario comparison": 'id="scenarioCompareSection"',
    "Region validation": 'id="regionValidationSection"',
    "Column mapping panel": 'id="columnMappingSection"',
    "Results preview": 'id="resultsPreviewSection"',
    "Skip link": 'class="skip-link"',
    "Theme toggle": "toggleTheme()",
    "Sample CSV preview": 'class="sample-csv"',
  };
  // A bare id-shaped marker is routed through hasElementId, not a raw substring:
  // includes() would accept the id sitting in data-section-id= or aria-controls=
  // rather than on a real element tag — the false positive hasElementId exists
  // to prevent. Attribute (id="…", class="…") and call-expression (foo()) markers
  // are already specific enough for includes().
  const isBareId = (s) => /^[A-Za-z][\w-]*$/.test(s);
  Object.entries(MARKERS).forEach(([label, needle]) => {
    const present = (p) =>
      isBareId(needle) ? hasElementId(p, needle) : html[p].includes(needle);
    const missing = PAGES.filter((p) => !present(p));
    check(
      `${label} is on all four pages`,
      missing.length === 0,
      `missing from: ${missing.map(short).join(", ")}`,
    );
  });
}

// ─── MinGen specifically: exactly one native control per cloud ───────────────
// The design that replaced the cross-provider scale. Asserted directly because
// it is the newest divergence and the easiest to half-apply.
console.log("[MinGen is native per cloud on every page]");
{
  // All four ids are counted on every page, so the assertion is "exactly this
  // set and nothing else" rather than "the one I remembered to exclude".
  const MINGEN_IDS = [
    "ruleDefaultMinGen",
    "ruleDefaultMinGenAws",
    "ruleDefaultMinGenAzure",
    "ruleDefaultMinGenGcp",
  ];
  const minGenIdsOn = (p) => MINGEN_IDS.filter((id) => hasElementId(p, id));

  ["aws.html", "azure.html", "gcp.html"].forEach((p) => {
    const found = minGenIdsOn(p);
    check(
      `${short(p)} carries exactly one Min Gen control, the shared one`,
      found.length === 1 && found[0] === "ruleDefaultMinGen",
      `found: [${found.join(", ") || "none"}]`,
    );
  });

  const found = minGenIdsOn("multicloud.html");
  check(
    "multicloud carries exactly the three native controls and no shared one",
    found.length === 3 && !found.includes("ruleDefaultMinGen"),
    `found: [${found.join(", ") || "none"}]`,
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = failures ? 1 : 0;
