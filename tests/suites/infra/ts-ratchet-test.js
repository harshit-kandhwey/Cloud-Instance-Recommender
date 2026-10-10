// The type check was turned on for src/ in stages (3.21), with `// @ts-nocheck` marking
// each file still being fixed. Every file is checked now, so no file in src/, scripts/
// or tests/ may opt out again.
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

// TypeScript reads the pragma from any comment at the top of a file, not only line 1,
// and accepts the spellings below. A comment that merely mentions the marker in prose
// does not start with it, so it is not an opt-out.
const OPT_OUT = /^[ \t]*(?:\/\/\/?|\/\*+)[ \t]*@ts-nocheck\b/m;
const optsOut = (text) => OPT_OUT.test(text);

const marked = (dir) =>
  walk(path.join(REPO, dir)).filter((f) => optsOut(fs.readFileSync(f, "utf8")));

console.log("[the detector sees every spelling of the marker]");
const code = "const a = 1;\n";
for (const [name, text] of [
  ["on line 1", `// @ts-nocheck\n${code}`],
  [
    "on line 3 under a header comment",
    `// Header\n//\n// @ts-nocheck\n${code}`,
  ],
  ["without a space", `//@ts-nocheck\n${code}`],
  ["with three slashes", `/// @ts-nocheck\n${code}`],
  ["with a reason after it", `// @ts-nocheck pending the ui stage\n${code}`],
  ["with CRLF line endings", `// Header\r\n// @ts-nocheck\r\n${code}`],
  ["in a block comment", `/* @ts-nocheck */\n${code}`],
  ["indented", `  // @ts-nocheck\n${code}`],
]) {
  check(`marker ${name} is an opt-out`, optsOut(text));
}
for (const [name, text] of [
  [
    "prose that mentions it",
    `// The marker \`// @ts-nocheck\` is forbidden.\n${code}`,
  ],
  ["a string that holds it", `const s = "// @ts-nocheck";\n${code}`],
  ["a different pragma", `// @ts-check\n${code}`],
  ["a longer word", `// @ts-nochecked\n${code}`],
]) {
  check(`${name} is not an opt-out`, !optsOut(text));
}

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
