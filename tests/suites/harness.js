// Shared simulated-DOM harness for the ingest-side suites.
//
// Not named *-test.js, so run-all.js does not pick it up as a suite.
//
// This existed as four verbatim copies that had already begun to drift — one
// grew a working classList.toggle, one a scrollIntoView, one a real localStorage
// — which meant a suite could pass or fail on which copy it happened to hold,
// rather than on the code under test.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");

const APP_SCRIPTS = [
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
  "js/base/charts.js",
  "js/base/downloads.js",
];

/**
 * @param {object} [options]
 * @param {string[]} [options.missingElements] ids getElementById should return
 *   null for, to model a page that lacks that placeholder
 * @param {object} [options.seedStorage] initial localStorage contents
 * @param {string} [options.dataScript] provider data file (decides page providers)
 */
function buildContext({
  missingElements = [],
  seedStorage = {},
  dataScript = "js/aws/aws-data.js",
} = {}) {
  const elements = {};
  const toasts = [];
  // A REAL store. Suites that assert what survives an upload need one; a stub
  // that forgets would let those assertions pass without testing anything.
  const store = new Map(Object.entries(seedStorage));
  const absent = new Set(missingElements);

  function fakeElement(id) {
    if (!elements[id]) {
      elements[id] = {
        id,
        innerHTML: "",
        className: "",
        textContent: "",
        style: {},
        value: "",
        checked: false,
        focused: false,
        classes: new Set(["hidden"]),
        attrs: {},
        classList: {
          add: (c) => elements[id].classes.add(c),
          remove: (c) => elements[id].classes.delete(c),
          // A real toggle: a no-op one silently breaks any panel that opens and
          // closes, and the test would never notice.
          toggle: (c) =>
            elements[id].classes.has(c)
              ? elements[id].classes.delete(c)
              : elements[id].classes.add(c),
          contains: (c) => elements[id].classes.has(c),
        },
        focus: () => {
          elements[id].focused = true;
        },
        addEventListener: () => {},
        querySelectorAll: () => [],
        setSelectionRange: () => {},
        scrollIntoView: () => {},
        // Attributes are remembered, for the same reason classList.toggle and
        // localStorage are real: a set that cannot be read back is a stub that
        // would let an attribute assertion pass without ever testing anything.
        // Named `attrs` to match the context step9-test builds for the pages.
        setAttribute: (name, value) => {
          elements[id].attrs[name] = String(value);
        },
        getAttribute: (name) =>
          name in elements[id].attrs ? elements[id].attrs[name] : null,
      };
    }
    return elements[id];
  }

  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    // The CSV branch of ingestFile goes through FileReader, which Node has not
    FileReader: class {
      readAsText(file) {
        Promise.resolve(file.text()).then((t) => {
          this.onload && this.onload({ target: { result: t } });
        });
      }
    },
  };
  sandbox.window = sandbox;
  sandbox.document = {
    createElement: (tag) => ({ tag, style: {}, setAttribute: () => {} }),
    getElementById: (id) => (absent.has(id) ? null : fakeElement(id)),
    querySelectorAll: (sel) =>
      sel === "script[src]" ? [{ src: dataScript }] : [],
    addEventListener: () => {},
    head: {
      appendChild(script) {
        if (script.tag !== "script") return;
        setTimeout(() => {
          try {
            const code = fs.readFileSync(path.join(REPO, script.src), "utf8");
            vm.runInContext(code, ctx, { filename: script.src });
            script.onload && script.onload();
          } catch (e) {
            script.onerror && script.onerror(e);
          }
        }, 0);
      },
    },
    body: { appendChild: () => {}, removeChild: () => {} },
  };

  const ctx = vm.createContext(sandbox);
  const load = (rel) =>
    vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
      filename: rel,
    });
  load(dataScript);
  for (const f of APP_SCRIPTS) load(f);

  // Capture toasts instead of rendering them
  ctx.showToast = (message, type) => toasts.push({ message, type });

  return { ctx, elements, toasts, store };
}

function makeChecker() {
  const state = { failures: 0 };
  const check = (name, cond, detail) => {
    if (cond) console.log(`  ok: ${name}`);
    else {
      state.failures++;
      console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
    }
  };
  return { check, state };
}

// The module-scoped `let` bindings in app-core.js shadow the sandbox's own
// properties inside a vm context, so they can only be read by evaluating their
// name IN the context — ctx.csvData is a different, stale thing.
const rowsOf = (ctx) => vm.runInContext("csvData", ctx);
const headersOf = (ctx) => vm.runInContext("columnHeaders", ctx);
const parse = (ctx, text) =>
  vm.runInContext(`parseCSV(${JSON.stringify(text)})`, ctx);

// Answer an open mapping panel the way a user would: pick the source column for
// each canonical, then confirm. Each select is keyed by the canonical's POSITION
// and carries the source header's INDEX as its value, not its name — so a suite
// that hard-codes either drifts the moment the panel changes. Shared, because it
// was written twice and the two copies had already begun to differ.
function confirmMapping(ctx, choices) {
  const pending = ctx.window._pendingIngest;
  const canonicals = ctx.pageCanonicals();
  for (const [canonical, source] of Object.entries(choices)) {
    // Both lookups return -1 on a miss, and getElementById here fabricates any
    // id it is asked for — so a typo would quietly drive a phantom "colmap_-1"
    // and the suite would go green having mapped nothing. Refuse instead: a
    // shared helper that absorbs its caller's mistakes hides the very mismatch
    // the caller is testing for.
    const canonicalIndex = canonicals.indexOf(canonical);
    if (canonicalIndex === -1) {
      throw new Error(
        `confirmMapping: no such canonical column "${canonical}"`,
      );
    }
    const sourceIndex = pending.headers.indexOf(source);
    if (sourceIndex === -1) {
      throw new Error(`confirmMapping: no such source header "${source}"`);
    }
    ctx.document.getElementById(`colmap_${canonicalIndex}`).value =
      String(sourceIndex);
  }
  ctx.applyColumnMapping();
}

module.exports = {
  REPO,
  buildContext,
  makeChecker,
  rowsOf,
  headersOf,
  parse,
  confirmMapping,
};
