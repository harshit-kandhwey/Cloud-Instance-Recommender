// The type check was turned on for src/ in stages (3.21), with `// @ts-nocheck` as the
// first line of each file still being fixed. Every file is checked now, so no file in
// src/, scripts/ or tests/ may opt out again.
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      return ["node_modules", "vendor", "__screenshots__"].includes(e.name)
        ? []
        : walk(p);
    }
    return p.endsWith(".js") ? [p] : [];
  });
}

const marked = (dir) =>
  walk(path.join(REPO, dir)).filter((f) => {
    const first = fs.readFileSync(f, "utf8").split(/\r?\n/, 1)[0];
    return first.trim() === "// @ts-nocheck";
  });

const inSrc = marked("src").map((f) => path.relative(REPO, f));
check(
  "no file in src/ opts out of the type check",
  inSrc.length === 0,
  `${inSrc.length} marked: ${inSrc.join(", ")}`,
);

const elsewhere = [...marked("scripts"), ...marked("tests")].map((f) =>
  path.relative(REPO, f),
);
check(
  "no file in scripts/ or tests/ opts out of the type check",
  elsewhere.length === 0,
  elsewhere.join(", "),
);

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("ts-ratchet-test: all checks passed");
}
