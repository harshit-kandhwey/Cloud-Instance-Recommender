// The coverage ledger's tool tier (3.19) must see every callable a tool exposes,
// including arrow and function-expression exports, or a tool function can go
// uncounted and the gate never lists it. build-coverage-inventory.js runs at top
// level and exports nothing, so this suite lifts its declaredNames snippet out of
// the real source and runs it on a sample that mixes the three declaration shapes.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const src = fs
  .readFileSync(
    path.join(REPO, "scripts", "testing", "build-coverage-inventory.js"),
    "utf8",
  )
  .replace(/\r\n/g, "\n");
const start = src.indexOf("const DECLARED_NAME_PATTERNS");
const fnAt = src.indexOf("function declaredNames");
const closeAt = fnAt === -1 ? -1 : src.indexOf("\n}\n", fnAt);
const end = closeAt === -1 ? -1 : closeAt + 3;
check(
  "the declaredNames snippet is found in the real tool source",
  start !== -1 && fnAt !== -1 && end > fnAt,
);
if (start === -1 || fnAt === -1 || end === -1) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exit(1);
}

const declaredNames = vm.runInNewContext(
  `${src.slice(start, end)}\n;declaredNames`,
  {},
);

const sample = [
  "function plainDecl(a) { return a; }",
  "async function asyncDecl() {}",
  "const arrowExport = (x) => x * 2;",
  "const asyncArrow = async x => x;",
  "const fnExpr = function () {};",
  "const asyncFnExpr = async function () {};",
  "const notAFunction = 5;",
  "  const nested = () => 1;",
].join("\n");

const found = [...declaredNames(sample)].sort();
const expected = [
  "arrowExport",
  "asyncArrow",
  "asyncDecl",
  "asyncFnExpr",
  "fnExpr",
  "plainDecl",
];
check(
  "finds every top-level callable shape and nothing else",
  JSON.stringify(found) === JSON.stringify(expected),
  `found [${found.join(", ")}] expected [${expected.join(", ")}]`,
);

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("coverage-inventory-names-test: all checks passed");
}
