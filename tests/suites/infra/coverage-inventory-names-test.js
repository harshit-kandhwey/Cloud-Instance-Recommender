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

// ── The behavioral surface: how a handler is found ───────────────────────────
// The gate only requires coverage for names a user can reach, and finds them by how
// the markup wires a control. Controls moved from an inline on…="name(" to
// data-on-<event>="name" and actionAttrs("<event>", "name") in 3.21; a scan that only
// knew the inline form stopped seeing them, and the behavioral set shrank from 90 names
// to 13 with the gate still green. This pins every wiring form.
console.log("[the gate finds a handler however the control is wired]");
{
  const kwAt = src.indexOf("const KEYWORDS = new Set");
  const hrAt = src.indexOf("function handlerReferences");
  const hrEnd = hrAt === -1 ? -1 : src.indexOf("\n}\n", hrAt) + 3;
  check(
    "the handler detection is found in the real tool source",
    kwAt !== -1 && hrAt > kwAt && hrEnd > hrAt,
  );
  if (kwAt !== -1 && hrAt > kwAt && hrEnd > hrAt) {
    const handlerReferences = vm.runInNewContext(
      `${src.slice(kwAt, hrEnd)}\n;handlerReferences`,
      {},
    );
    const refs = (html, js) =>
      handlerReferences(html, js)
        .map((r) => `${r.name}:${r.reason}`)
        .sort();
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    check(
      "an inline onclick on a page is a page handler",
      same(refs('<button onclick="doThing()">x</button>', ""), [
        "doThing:html-handler",
      ]),
      JSON.stringify(refs('<button onclick="doThing()">x</button>', "")),
    );
    check(
      "data-on-<event> and data-then-<event> on a page are page handlers, for any event",
      same(
        refs(
          '<button data-on-click="saveAll" data-then-click="refresh"></button><select data-on-change="onPick"></select><input data-on-input="onType" data-on-keydown="onKey" data-on-blur="onLeave">',
          "",
        ),
        [
          "onKey:html-handler",
          "onLeave:html-handler",
          "onPick:html-handler",
          "onType:html-handler",
          "refresh:html-handler",
          "saveAll:html-handler",
        ],
      ),
    );
    check(
      "an inline handler in generated markup is a generated handler, and a keyword is not",
      same(
        refs(
          "",
          'const a = `<b onclick=\\"fromTemplate(1)\\">`; const b = `<i onclick="if(x)">`;',
        ),
        ["fromTemplate:generated-handler"],
      ),
    );
    check(
      "data-on-<event> in a generated string is a generated handler, escaped quotes or not",
      same(
        refs(
          "",
          'const a = `<b data-on-click="plainTpl">`; const b = "<b data-on-click=\\"escapedTpl\\">";',
        ),
        ["escapedTpl:generated-handler", "plainTpl:generated-handler"],
      ),
    );
    check(
      "actionAttrs names its handler, with either quote, and its then option names a second",
      same(
        refs(
          "",
          'x = actionAttrs("click", "pickRow", [1]); y = actionAttrs(\'change\', \'onToggle\'); z = actionAttrs("click", "save", [], { then: "afterSave" });',
        ),
        [
          "afterSave:generated-handler",
          "onToggle:generated-handler",
          "pickRow:generated-handler",
          "save:generated-handler",
        ],
      ),
    );
    check(
      "a name with a dollar sign is kept whole",
      same(refs('<b data-on-click="a$b">', ""), ["a$b:html-handler"]),
    );
    check(
      "things that only look similar are not handlers",
      same(
        refs(
          '<b data-once="no" data-only-click="no" data-on="no" data-on-click="">',
          'actionAttrs("click", someVariable); const then = 1; x = { thens: "no" };',
        ),
        [],
      ),
      JSON.stringify(
        refs(
          '<b data-once="no" data-only-click="no" data-on="no" data-on-click="">',
          'actionAttrs("click", someVariable); const then = 1; x = { thens: "no" };',
        ),
      ),
    );
    check(
      "page markup is read with page patterns and generated markup with generated ones",
      same(refs('<b data-on-click="onlyInPage">', ""), [
        "onlyInPage:html-handler",
      ]) &&
        same(refs("", '<b data-on-click="onlyInJs">'), [
          "onlyInJs:generated-handler",
        ]),
    );
  }
}

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("coverage-inventory-names-test: all checks passed");
}
