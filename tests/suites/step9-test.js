// Step 9 verification: accessibility affordances.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

// ── DOM stub with attribute support ─────────────────────────────────────────
function makeAttrElement(extra = {}) {
  const el = {
    attrs: {},
    listeners: {},
    innerHTML: "",
    className: "",
    style: {},
    value: "",
    classes: new Set(),
    setAttribute(k, v) {
      el.attrs[k] = String(v);
    },
    getAttribute(k) {
      return el.attrs[k] ?? null;
    },
    addEventListener(t, fn) {
      (el.listeners[t] = el.listeners[t] || []).push(fn);
    },
    click() {
      (el.listeners.click || []).forEach((f) => f({}));
      if (el.onclick) el.onclick();
    },
    classList: {
      add: (c) => el.classes.add(c),
      remove: (c) => el.classes.delete(c),
      toggle: (c) =>
        el.classes.has(c) ? el.classes.delete(c) : el.classes.add(c),
      contains: (c) => el.classes.has(c),
    },
    querySelectorAll: () => [],
    focus: () => {},
    setSelectionRange: () => {},
    scrollIntoView: () => {},
    ...extra,
  };
  return el;
}

// Two collapsible sections: one open, one collapsed
const sectionOpen = makeAttrElement();
const headerOpen = makeAttrElement();
headerOpen.parentElement = sectionOpen;
const sectionCollapsed = makeAttrElement();
sectionCollapsed.classes.add("collapsed");
const headerCollapsed = makeAttrElement();
headerCollapsed.parentElement = sectionCollapsed;
headerOpen.onclick = () => ctx.toggleSection(headerOpen);
headerCollapsed.onclick = () => ctx.toggleSection(headerCollapsed);

const elements = {};
function fakeElement(id) {
  if (!elements[id]) elements[id] = makeAttrElement({ id });
  return elements[id];
}

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  alert: () => {},
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};
sandbox.window = sandbox;
sandbox.document = {
  createElement: () => makeAttrElement({ tag: "div" }),
  getElementById: (id) => fakeElement(id),
  querySelectorAll: (sel) => {
    if (sel === "script[src]") return [{ src: "js/aws/aws-data.js" }];
    if (sel === ".section-header[onclick]")
      return [headerOpen, headerCollapsed];
    return [];
  },
  addEventListener: () => {},
  head: { appendChild: () => {} },
  body: { appendChild: () => {}, removeChild: () => {} },
};
const ctx = vm.createContext(sandbox);
const load = (rel) => vm.runInContext(read(rel), ctx, { filename: rel });
load("js/aws/aws-data.js");
for (const f of [
  "js/base/rule-engine.js",
  "js/base/base-instance-selector.js",
  "js/aws/aws-instance-selector.js",
  "js/azure/azure-instance-selector.js",
  "js/gcp/gcp-instance-selector.js",
  "js/base/instance-selector-factory.js",
  "js/base/app-core.js",
  "js/base/ui-shell.js",
  "js/base/ingest.js",
  "js/base/manual-entry.js",
  "js/base/form-controls.js",
  "js/base/generate.js",
  "js/base/preview.js",
  "js/base/downloads.js",
])
  load(f);

console.log("[section headers]");
ctx.enhanceAccessibility();
check(
  "role=button set",
  headerOpen.attrs.role === "button" && headerCollapsed.attrs.role === "button",
);
check("tabindex=0 set", headerOpen.attrs.tabindex === "0");
check(
  "open section aria-expanded=true",
  headerOpen.attrs["aria-expanded"] === "true",
);
check(
  "collapsed section aria-expanded=false",
  headerCollapsed.attrs["aria-expanded"] === "false",
);

// Keyboard: Enter on open header collapses it and syncs aria-expanded
let prevented = 0;
headerOpen.listeners.keydown[0]({
  key: "Enter",
  preventDefault: () => prevented++,
});
check("Enter triggers toggle", sectionOpen.classes.has("collapsed"));
check(
  "aria-expanded synced after toggle",
  headerOpen.attrs["aria-expanded"] === "false",
);
check("default prevented", prevented === 1);
headerOpen.listeners.keydown[0]({
  key: " ",
  preventDefault: () => prevented++,
});
check(
  "Space toggles back",
  !sectionOpen.classes.has("collapsed") &&
    headerOpen.attrs["aria-expanded"] === "true",
);
headerOpen.listeners.keydown[0]({
  key: "a",
  preventDefault: () => prevented++,
});
check("other keys ignored", prevented === 2);

console.log("[live regions]");
check(
  "fileStatus aria-live",
  elements.fileStatus.attrs["aria-live"] === "polite",
);
check(
  "progressText aria-live",
  elements.progressText.attrs["aria-live"] === "polite",
);
// Stub's getElementById auto-creates, so the creation branch can't run here —
// verify the toast attributes at source level instead
const src = read("js/base/app-core.js");
check(
  "toast sets role=status + aria-live in source",
  /toast\.setAttribute\("role", "status"\)/.test(src) &&
    /toast\.setAttribute\("aria-live", "polite"\)/.test(src),
);

console.log("[preview table a11y]");
const results = [
  {
    "VM Name": "b",
    "CPU Count": "2",
    "AWS Rules Applied": "",
    "AWS No Match Reason": "",
    "AWS Like-to-Like Instance": "m5.large",
  },
  {
    "VM Name": "a",
    "CPU Count": "4",
    "AWS Rules Applied": "",
    "AWS No Match Reason": "",
    "AWS Like-to-Like Instance": "r6i.large",
  },
];
vm.runInContext(`showResultsPreview(${JSON.stringify(results)})`, ctx);
const container = elements.resultsPreviewSection;
check(
  "th has tabindex + aria-sort=none initially",
  container.innerHTML.includes('tabindex="0" aria-sort="none"'),
);
check("th has keydown handler", container.innerHTML.includes("onkeydown="));
check(
  "search input labelled",
  container.innerHTML.includes('aria-label="Filter preview rows"'),
);
check(
  "copy button labelled",
  container.innerHTML.includes('aria-label="Copy row 1 as CSV"'),
);
ctx._sortPreview(0);
check(
  "sorted col aria-sort=ascending",
  container.innerHTML.includes('aria-sort="ascending"'),
);
ctx._sortPreview(0);
check(
  "re-sort flips to descending",
  container.innerHTML.includes('aria-sort="descending"'),
);

console.log("[page wiring]");
for (const f of [
  "index.html",
  "aws.html",
  "azure.html",
  "gcp.html",
  "multicloud.html",
]) {
  const c = read(f);
  check(
    `${f}: skip link + main id`,
    c.includes('class="skip-link" href="#main"') && c.includes('id="main"'),
  );
  check(
    `${f}: header emoji aria-hidden`,
    c.includes('<span aria-hidden="true">🌐</span>'),
  );
}
check(
  "theme.css has :focus-visible + .skip-link",
  read("css/theme.css").includes(":focus-visible") &&
    read("css/theme.css").includes(".skip-link"),
);
check(
  "user-guide has :focus-visible",
  read("user-guide.html").includes(":focus-visible"),
);

process.exit(failures ? 1 : 0);
