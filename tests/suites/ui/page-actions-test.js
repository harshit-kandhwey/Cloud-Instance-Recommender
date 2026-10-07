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

// Every page shares one CSP without 'unsafe-inline', so an inline handler on the landing
// page, the portfolio or the guide is dead, not merely unstyled: their theme buttons
// once did nothing while only the four tool pages were checked.
const everyPage = [
  ...pages,
  "app-portfolio.html",
  "index.html",
  "user-guide.html",
];
const inlineAnywhere = everyPage.filter((p) =>
  /\son[a-z]+\s*=\s*["']/.test(read(p)),
);
check(
  "no page carries an inline event handler attribute",
  inlineAnywhere.length === 0,
  inlineAnywhere.join(", "),
);
const themePages = everyPage.filter((p) =>
  read(p).includes('id="themeToggle"'),
);
check(
  "all seven pages have the theme toggle",
  themePages.length === 7,
  themePages.join(", "),
);
const undispatched = themePages.filter((p) => {
  const html = read(p);
  return (
    !html.includes('data-on-click="toggleTheme"') ||
    !/<script[^>]*src="src\/shared\/page-actions\.js"/.test(html) ||
    !/<script[^>]*src="src\/shared\/theme-init\.js"/.test(html)
  );
});
check(
  "every theme toggle is dispatched, and its page loads both the dispatcher and the theme script",
  undispatched.length === 0,
  undispatched.join(", "),
);

// An action must be defined by a script the page itself loads: a function that exists in
// src/ but is not loaded on that page is as dead as a misspelt name. Every event type
// counts, on all seven pages, and so do the actions that src markup names through
// actionAttrs, which only exist on pages that load the file doing the naming.
const definesFunction = (name, text) =>
  new RegExp(`function\\s+${name}\\s*\\(`).test(text) ||
  new RegExp(`window\\.${name}\\s*=`).test(text);
const loadedByPage = {};
for (const page of everyPage) {
  loadedByPage[page] = [
    ...read(page).matchAll(/<script[^>]*\ssrc="(src\/[^"]+)"/g),
  ].map((m) => m[1]);
}
const notLoaded = [];
let sweptNames = 0;
for (const page of everyPage) {
  const scripts = loadedByPage[page].map((s) => ({ file: s, text: read(s) }));
  const loadedText = scripts.map((s) => s.text).join("\n");
  const names = new Set(
    [...read(page).matchAll(/data-(?:on|then)-[a-z]+="([^"]+)"/g)].map(
      (m) => m[1],
    ),
  );
  for (const s of scripts) {
    for (const m of s.text.matchAll(
      /actionAttrs\(\s*["'][a-z]+["']\s*,\s*["']([^"']+)["']/g,
    )) {
      names.add(m[1]);
    }
  }
  sweptNames += names.size;
  for (const n of names) {
    if (!definesFunction(n, loadedText)) notLoaded.push(`${page}: ${n}`);
  }
}
check(
  "every action a page or its scripts name is defined by a script that page loads",
  notLoaded.length === 0 && sweptNames > 0,
  notLoaded.join("; ") || `${sweptNames} names swept`,
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
// inline handler attribute left in src/ would bypass the dispatcher, and under the strict
// CSP the browser would refuse it. Every event name counts, not a fixed list: a Columns
// menu once kept an ontoggle that a list of click, change and the like never saw. An
// attribute only counts inside a tag, so a variable named online is not mistaken for one.
const srcInlineHandlers = walk(path.join(REPO, "src")).flatMap((p) =>
  (
    fs
      .readFileSync(p, "utf8")
      .match(/<[a-zA-Z][^<>]*\son[a-z]+\s*=\s*\\?["']/g) || []
  ).map((m) => `${path.relative(REPO, p)}: ${m.slice(0, 60)}`),
);
check(
  "no inline handler attribute remains in src/",
  srcInlineHandlers.length === 0,
  srcInlineHandlers.join(" | "),
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

{
  const set = [];
  const makeNode = (attrs, kids) => {
    const node = {
      nodeType: 1,
      style: { setProperty: (k, v) => set.push([k, v]) },
      hasAttribute: (k) => k in attrs,
      getAttribute: (k) => attrs[k],
      querySelectorAll: () => kids,
    };
    return node;
  };
  const child = makeNode({ "data-style": '{"width":"75%"}' }, []);
  const root = makeNode(
    { "data-style": '{"background":"var(--good-strong)","height":"100%"}' },
    [child],
  );
  const plain = makeNode({}, []);
  const dsSandbox = { document: sandbox.document, window: {}, console };
  dsSandbox.window = dsSandbox;
  vm.runInContext(
    read("src/shared/page-actions.js"),
    vm.createContext(dsSandbox),
  );
  dsSandbox.applyDataStyles(root);
  dsSandbox.applyDataStyles(plain);
  check(
    "data-style declarations are applied to the node and its descendants",
    JSON.stringify(set) ===
      JSON.stringify([
        ["background", "var(--good-strong)"],
        ["height", "100%"],
        ["width", "75%"],
      ]),
    JSON.stringify(set),
  );

  const before = set.length;
  const bad = makeNode({ "data-style": "{not json" }, []);
  const notObject = makeNode({ "data-style": "null" }, []);
  const good = makeNode({ "data-style": '{"width":"10%"}' }, []);
  const batch = makeNode({}, [bad, notObject, good]);
  let threw = false;
  try {
    dsSandbox.applyDataStyles(batch);
  } catch (e) {
    threw = true;
  }
  check(
    "a malformed data-style is skipped and the rest of the batch is still styled",
    !threw &&
      JSON.stringify(set.slice(before)) === JSON.stringify([["width", "10%"]]),
    JSON.stringify(set.slice(before)),
  );
}

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("page-actions-test: all checks passed");
}
