// escapeCsvCell is the ONE guard every CSV export goes through (results,
// no-match, app summary, per-app, scenario comparison, and the preview's
// clipboard mirror), so it gets its own suite rather than being tested only
// through whichever export happened to need it.
//
// Two jobs, and they pull against each other:
//   1. Formula-injection hardening — a cell opening with = + - @ | or a control
//      character is prefixed with an apostrophe so Excel treats it as text.
//   2. Not corrupting data — a PLAIN NEGATIVE NUMBER also opens with "-", and
//      prefixing it makes Excel import it as text, silently breaking the sums
//      and formulas a user builds on the export. Arbitrary input columns are
//      spread into every result row (`const result = { ...row }`), so a user's
//      own "-1234.50" column really does reach the export.
// A pure numeric literal cannot be a formula, so exempting it costs nothing.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
const sandbox = { console: { log() {}, warn() {}, error() {} } };
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(REPO, "js/base/app-core.js"), "utf8"),
  ctx,
  {
    filename: "app-core.js",
  },
);
const esc = (v) => vm.runInContext("escapeCsvCell", ctx)(v);

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? "\n        " + detail : ""}`);
  }
};

console.log("[formula triggers are still hardened]");
{
  const cases = [
    ["=SUM(A1:A9)", "a leading equals"],
    ["+1+1", "a leading plus"],
    ["@SUM(A1)", "a leading at"],
    ["|calc", "a leading pipe"],
    ["\tcmd", "a leading tab"],
    ["\rcmd", "a leading carriage return"],
    ["-cmd", "a minus followed by a letter"],
    ["-1+1", "a minus that opens an expression, not a number"],
    ["-", "a bare minus"],
    ["-1e5", "scientific notation is not treated as a plain number"],
    ["-.5", "a leading dot is not a plain number"],
  ];
  cases.forEach(([input, label]) => {
    const out = esc(input);
    // The quoting pass may wrap it, so look for the apostrophe right after any
    // opening quote rather than assuming the string starts with it.
    const hardened = out.startsWith("'") || out.startsWith("\"'");
    check(
      `${label} is hardened`,
      hardened,
      `${JSON.stringify(input)} -> ${JSON.stringify(out)}`,
    );
  });
}

console.log("[plain negative numbers stay numbers]");
{
  const numbers = ["-5", "-1234.50", "-0.5", "-42", "-0"];
  numbers.forEach((n) => {
    check(
      `${n} is not prefixed`,
      esc(n) === n,
      `${JSON.stringify(n)} -> ${JSON.stringify(esc(n))}`,
    );
  });
  // Positives never opened with a trigger character, so they were always safe.
  check("a positive number is untouched", esc("42") === "42");
  check("a decimal is untouched", esc("3.14") === "3.14");
}

console.log("[quoting is unchanged]");
{
  check("a comma forces quotes", esc("a,b") === '"a,b"', esc("a,b"));
  check(
    "an embedded quote is doubled",
    esc('say "hi"') === '"say ""hi"""',
    esc('say "hi"'),
  );
  check(
    "a newline forces quotes",
    esc("a\nb") === '"a\nb"',
    JSON.stringify(esc("a\nb")),
  );
  check("a plain value is left alone", esc("m5.large") === "m5.large");
  check("null becomes empty", esc(null) === "");
  check("undefined becomes empty", esc(undefined) === "");
}

console.log("[a hardened value that also needs quoting gets both]");
{
  // Order matters: the apostrophe goes on first, then the whole thing is quoted.
  const out = esc("=A1,B2");
  check("prefixed then quoted", out === '"\'=A1,B2"', JSON.stringify(out));
}

process.exit(failures ? 1 : 0);
