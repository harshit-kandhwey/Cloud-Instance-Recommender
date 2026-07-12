// Vendored-artifact integrity:
//   - the checksums recorded in SECURITY.md match the files actually committed
//   - every vendored bundle is listed there
//
// These files are executable code shipped to every visitor, from our own origin,
// which is exactly where the CSP trusts scripts from. A bundle that changes
// without its checksum being updated in the same commit is the thing this
// catches — otherwise the table in SECURITY.md quietly becomes decoration.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = path.resolve(__dirname, "..", "..");
const VENDOR_DIR = path.join(REPO, "js", "vendor");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

const security = fs.readFileSync(path.join(REPO, "SECURITY.md"), "utf8");

// Only the "Artifact integrity" table counts. Scanning the whole document would
// let a stale table pass because some OTHER section happened to mention the same
// path and hash.
const integrity =
  security.match(/### Artifact integrity([\s\S]*?)(?=\n#{1,3} |$)/)?.[1] ?? "";

console.log("[the integrity table exists and is parseable]");
check("SECURITY.md has an Artifact integrity section", integrity.length > 0);

// `| js/vendor/x.min.js | <64 hex> |` — however the table happens to be padded
const recorded = new Map();
for (const m of integrity.matchAll(
  /`(js\/vendor\/[\w.-]+\.js)`\s*\|\s*`([a-f0-9]{64})`/g,
)) {
  recorded.set(m[1], m[2]);
}

const bundles = fs
  .readdirSync(VENDOR_DIR)
  .filter((f) => f.endsWith(".js"))
  .map((f) => `js/vendor/${f}`);
const present = new Set(bundles);

console.log("[the table and the directory agree, both ways]");
check(
  "every vendored bundle has a recorded checksum",
  bundles.every((b) => recorded.has(b)),
  `unrecorded: ${bundles.filter((b) => !recorded.has(b)).join(", ")}`,
);
// The reverse: a row for a file that was renamed or deleted is stale, and a
// one-way check would happily leave it there forever
const stale = [...recorded.keys()].filter((b) => !present.has(b));
check(
  "no checksum rows for bundles that no longer exist",
  stale.length === 0,
  `stale rows: ${stale.join(", ")}`,
);

// A checksum is only meaningful if every checkout produces the same bytes. With
// git's line-ending translation on (the Windows default) it does not: a bundle
// containing even one newline is rewritten on checkout, and a checksum recorded
// from that working copy matches on no other machine — which is exactly how this
// table first went wrong. `-text` pins the bytes; assert it stays pinned.
console.log("[git will not rewrite the bytes these checksums describe]");
const attributes = fs.existsSync(path.join(REPO, ".gitattributes"))
  ? fs.readFileSync(path.join(REPO, ".gitattributes"), "utf8")
  : "";
check(
  ".gitattributes exempts js/vendor from line-ending translation",
  /^\s*js\/vendor\/\S*\s+.*-text\b/m.test(attributes),
  "without `js/vendor/** -text` these checksums are platform-dependent",
);

console.log("[checksums match the committed files]");
for (const bundle of bundles) {
  const expected = recorded.get(bundle);
  if (!expected) continue;
  const actual = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(REPO, bundle)))
    .digest("hex");
  check(
    `${bundle} matches its recorded SHA-256`,
    actual === expected,
    `recorded ${expected}, got ${actual} — if you replaced this bundle, update the checksum in SECURITY.md in the same commit (and record the upstream URL you downloaded it from)`,
  );
}

process.exit(failures ? 1 : 0);
