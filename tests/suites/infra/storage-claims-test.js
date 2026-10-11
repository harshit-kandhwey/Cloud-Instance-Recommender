// storage-claims suite: pins what the product says it stores against what it stores.
// Every result row carries the uploaded columns into a snapshot and into the App
// Portfolio copy, so a statement that the inventory is never stored would be false in
// the privacy note, the README, the architecture document, the user guide and the
// snapshot panel. A claim that reads as reassurance and is false is the hazard, so the
// false phrasings are banned and the keys that hold uploaded data must be named where
// a reader looks.
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
// Prose is wrapped across lines and tags in the HTML; compare on collapsed text.
const flat = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

// What each owned key can hold of the user's upload. Every key must be classified, so
// a new key forces a decision here instead of silently inheriting the old claim.
//   rows      - result rows, which carry the uploaded columns
//   app-names - app names taken from a cell of the upload
//   headers   - header text of the upload
//   none      - preference or derived setting
const CLASSIFIED = {
  appMap: "app-names",
  columnMaps: "headers",
  filterPresets: "none",
  fleetSnapshots: "rows",
  manualVMs: "none",
  portfolioData: "rows",
  sections: "none",
  sizingPolicies: "none",
  stats: "none",
  theme: "none",
  userRules: "none",
};

const storageKeysText = read("src/shared/storage-keys.js");
const ownedKeys = [...storageKeysText.matchAll(/^\s{2}(\w+):\s*"/gm)].map(
  (m) => m[1],
);

check(
  "the scan found the owned storage keys",
  ownedKeys.length >= 11,
  String(ownedKeys.length),
);
const unclassified = ownedKeys.filter((k) => !(k in CLASSIFIED));
check(
  "every owned storage key is classified for what it can hold of an upload",
  unclassified.length === 0,
  unclassified.join(", "),
);
const stale = Object.keys(CLASSIFIED).filter((k) => !ownedKeys.includes(k));
check(
  "the classification names no key that no longer exists",
  stale.length === 0,
  stale.join(", "),
);

const BANNED = [
  "never stores the raw inventory",
  "inventory is never stored",
  "never the inventory",
  "never the raw inventory",
  "does not hold your original inventory",
  "it does not hold your inventory",
  "no inventory data stored",
  "used for preferences only",
];
const SURFACES = [
  "index.html",
  "README.md",
  "user-guide.html",
  "docs/ARCHITECTURE.md",
  "src/ui/storage-manager-ui.js",
  "src/features/fleet-snapshots.js",
];
for (const rel of SURFACES) {
  const text = flat(read(rel));
  const hits = BANNED.filter((p) => text.includes(p));
  check(
    `${rel} makes no claim that the inventory is never stored`,
    hits.length === 0,
    hits.join(" | "),
  );
}

// The two places a visitor reads what is kept must name every key that holds rows.
const ROW_HOLDERS = Object.entries(CLASSIFIED)
  .filter(([, kind]) => kind === "rows")
  .map(([k]) => k);
check(
  "the rows classification is the two keys the claims below are written for",
  JSON.stringify(ROW_HOLDERS.sort()) ===
    JSON.stringify(["fleetSnapshots", "portfolioData"]),
  ROW_HOLDERS.join(","),
);
{
  // Scoped to the paragraph itself: "app portfolio" also appears in the page's links,
  // so a whole-page search would pass with the sentence deleted.
  const page = flat(read("index.html"));
  const start = page.indexOf("only what you set or ask for is kept");
  check("the privacy note's storage paragraph was found", start >= 0);
  const text = start >= 0 ? page.slice(start, start + 900) : "";
  check(
    "the privacy note names fleet snapshots, the App Portfolio copy and the uploaded columns",
    text.includes("fleet snapshot") &&
      text.includes("app portfolio page reads") &&
      text.includes("columns you uploaded"),
    text.slice(0, 200),
  );
  check(
    "the privacy note says the portfolio copy goes when that page is next opened after a day",
    text.includes(
      "removed the next time that page is opened after it is a day old",
    ),
  );
  check(
    "the privacy note says the original file itself is not stored",
    text.includes("original file itself is never stored"),
  );
}
{
  const line = flat(read("README.md"))
    .split(" - **")
    .find((s) => s.startsWith("local storage"));
  check(
    "the README's Local Storage entry names fleet snapshots and the App Portfolio copy",
    !!line &&
      line.includes("fleet snapshots") &&
      line.includes("app portfolio"),
    String(line).slice(0, 120),
  );
}
check(
  "the architecture document says a snapshot holds the inventory's data",
  flat(read("docs/ARCHITECTURE.md")).includes(
    "a snapshot holds the inventory's data",
  ),
);
check(
  "the snapshot panel says the results include the uploaded columns",
  flat(read("src/ui/storage-manager-ui.js")).includes(
    "include the columns you uploaded",
  ),
);

if (state.failures) {
  console.error(`\nstorage-claims: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nstorage-claims: all checks passed");
  process.exitCode = 0;
}
