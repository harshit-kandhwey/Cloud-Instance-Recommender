// The tool pages' controls dispatch through src/shared/page-actions.js (3.21 phase
// 5, slice 2). Covered: no inline handler attribute remains on the four pages; every
// function a control names exists in src/; and the dispatcher reproduces the old
// inline call forms (no argument, this, one string, and a second call after the first).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO, buildEngineContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const pages = ["aws.html", "azure.html", "gcp.html", "multicloud.html"];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
}
const srcText = walk(path.join(REPO, "src"))
  .map((p) => fs.readFileSync(p, "utf8"))
  .join("\n");

const named = new Set();
let inlineLeft = 0;
for (const page of pages) {
  const html = read(page);
  inlineLeft += (html.match(/\son(click|change)="/g) || []).length;
  for (const m of html.matchAll(
    /data-(?:on-click|on-change|then)="([^"]+)"/g,
  )) {
    named.add(m[1]);
  }
}
check(
  "no inline click or change handler remains on the four pages",
  inlineLeft === 0,
  `${inlineLeft} left`,
);
check(
  "the pages name at least one dispatched action",
  named.size > 0,
  `${named.size}`,
);

const unresolved = [...named].filter(
  (n) =>
    !new RegExp(`function\\s+${n}\\s*\\(`).test(srcText) &&
    !new RegExp(`window\\.${n}\\s*=`).test(srcText),
);
check(
  "every named action is a function defined in src/",
  unresolved.length === 0,
  unresolved.join(", "),
);

const listeners = {};
function makeEl(attrs) {
  return {
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
  };
}
const calls = [];
const sandbox = {
  document: {
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
  },
  calls,
};
sandbox.window = sandbox;
sandbox.fnA = function (...args) {
  calls.push(["fnA", args.length, this && this.tag]);
};
sandbox.fnB = function (...args) {
  calls.push(["fnB", args, this]);
};
sandbox.fnC = function () {
  calls.push(["fnC"]);
};
vm.runInContext(read("src/shared/page-actions.js"), vm.createContext(sandbox));

function fire(type, el) {
  listeners[type]({
    target: {
      closest: (sel) =>
        sel === `[data-on-${type}]` && el.hasAttribute(`data-on-${type}`)
          ? el
          : null,
    },
  });
}

calls.length = 0;
fire("click", makeEl({ "data-on-click": "fnA" }));
check(
  "a plain control calls its function with no argument",
  calls.length === 1 && calls[0][1] === 0,
  JSON.stringify(calls),
);

calls.length = 0;
const withThis = makeEl({ "data-on-click": "fnB", "data-this": "" });
withThis.tag = "self";
fire("click", withThis);
check(
  "a this-control passes the element as its argument and as this",
  calls.length === 1 && calls[0][1][0] === withThis && calls[0][2] === withThis,
  JSON.stringify(calls),
);

calls.length = 0;
fire("change", makeEl({ "data-on-change": "fnB", "data-arg": "gcp" }));
check(
  "an argument control passes its one string",
  calls.length === 1 && calls[0][1][0] === "gcp",
  JSON.stringify(calls),
);

calls.length = 0;
fire("change", makeEl({ "data-on-change": "fnA", "data-then-change": "fnC" }));
check(
  "a paired control runs the second function after the first",
  calls.length === 2 && calls[0][0] === "fnA" && calls[1][0] === "fnC",
  JSON.stringify(calls),
);

calls.length = 0;
fire("click", makeEl({ "data-on-click": "missingFunction" }));
check("a control naming a missing function does nothing", calls.length === 0);

// Generated markup (src/**) builds controls through actionAttrs (app-core.js). Any
// inline handler attribute left in src/ would bypass the dispatcher.
const srcInlineHandlers = walk(path.join(REPO, "src"))
  .map((p) => fs.readFileSync(p, "utf8"))
  .join("\n")
  .match(/ on(click|change|input|keydown|keyup|blur|submit|focus)="/g);
check(
  "no inline handler attribute remains in src/",
  !srcInlineHandlers,
  srcInlineHandlers ? srcInlineHandlers.join(", ") : "",
);

{
  const appCore = buildEngineContext({
    scripts: ["src/shared/storage-keys.js", "src/shared/app-core.js"],
    label: "action-attrs",
  });
  const out = appCore.run(
    `actionAttrs("click", "pick", [1, "x\\"y", { $: "value" }], { self: true })`,
  );
  const dataArgs = /data-args-click="([^"]*)"/.exec(out);
  const decoded = dataArgs
    ? JSON.parse(dataArgs[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"))
    : null;
  check(
    "actionAttrs emits the handler and escaped JSON arguments",
    out.includes('data-on-click="pick"') &&
      decoded !== null &&
      decoded.length === 4 &&
      decoded[1] === 1 &&
      decoded[2] === 'x"y' &&
      decoded[3].$ === "value",
    out,
  );
  check(
    "actionAttrs puts the element first when self is set",
    decoded !== null && decoded[0].$ === "this",
  );
}

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("page-actions-test: all checks passed");
}
