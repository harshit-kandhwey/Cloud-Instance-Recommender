// The type check is being turned on for src/ in stages (3.21). A src/ file that still
// has type errors carries `// @ts-nocheck` as its first line. This ratchet lets that list
// only shrink: fix a folder, delete its markers, and lower PENDING_LIMIT in the same
// commit. scripts/ and tests/ are fully checked and may never carry the marker.
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();

// Files in src/ still marked. Lower this as each stage lands; it reaches 0 at the end.
const PENDING_LIMIT = 15;

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
  `at most ${PENDING_LIMIT} src files are still pending the type check`,
  inSrc.length <= PENDING_LIMIT,
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
