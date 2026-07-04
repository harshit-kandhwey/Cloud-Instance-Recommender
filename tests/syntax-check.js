// Syntax-checks every first-party JS file (node --check). Generated region
// data and vendored libraries are skipped — they're validated at generation
// / vendoring time and only slow this down.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const targets = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "regions" || entry.name === "vendor") continue;
      walk(full);
    } else if (entry.name.endsWith(".js")) {
      targets.push(full);
    }
  }
}

for (const dir of ["js", "tools", "tests"]) {
  walk(path.join(repoRoot, dir));
}
// Manifests are under js/{p}/ directly, already included by the walk above.

let failed = 0;
for (const file of targets) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failed++;
    console.error(`SYNTAX FAIL: ${path.relative(repoRoot, file)}`);
    process.stderr.write(result.stderr || "");
  }
}

console.log(
  `Checked ${targets.length} files — ${failed ? failed + " failure(s)" : "all OK"}`,
);
process.exit(failed ? 1 : 0);
