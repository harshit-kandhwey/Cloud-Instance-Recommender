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

// `| js/vendor/x.min.js | <64 hex> |` — however the table happens to be padded
const recorded = new Map();
for (const m of security.matchAll(
  /`(js\/vendor\/[\w.-]+\.js)`\s*\|\s*`([a-f0-9]{64})`/g,
)) {
  recorded.set(m[1], m[2]);
}

const bundles = fs
  .readdirSync(VENDOR_DIR)
  .filter((f) => f.endsWith(".js"))
  .map((f) => `js/vendor/${f}`);

console.log("[vendored bundles are all accounted for]");
check(
  "SECURITY.md records a checksum for every vendored bundle",
  bundles.every((b) => recorded.has(b)),
  `missing: ${bundles.filter((b) => !recorded.has(b)).join(", ")}`,
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
