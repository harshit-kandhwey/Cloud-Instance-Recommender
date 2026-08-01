// Shared test contexts.
//
// Two factories live here, both because a forked copy that drifts is the classic
// silent-guard risk (a suite passing or failing on which copy it held, not on the
// code under test):
//   - buildContext:       the full simulated-DOM harness — loads the whole app
//                         into a vm with a fake page, for the ingest/UI suites.
//   - buildEngineContext: a minimal, DOM-free vm — for the pure-engine suites
//                         (rule-engine and the instance selectors compute over
//                         injected data, no page), which had each forked the same
//                         createContext + load + run boilerplate.
//
// Not named *-test.js, so run-all.js does not pick it up as a suite.
//
// buildContext existed as four verbatim copies that had already begun to drift —
// one grew a working classList.toggle, one a scrollIntoView, one a real
// localStorage — which meant a suite could pass or fail on which copy it happened
// to hold, rather than on the code under test.
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
 * @param {string[]} [options.dataScripts] several provider data files, for a
 *   multicloud page; overrides dataScript when given
 * @param {boolean} [options.storageThrows] model a browser where localStorage
 *   throws (private mode), so a suite can prove the flow survives it
 */
function buildContext({
  missingElements = [],
  seedStorage = {},
  dataScript = "js/aws/aws-data.js",
  dataScripts,
  storageThrows = false,
} = {}) {
  const scripts = dataScripts || [dataScript];
  const elements = {};
  const toasts = [];
  // Scripts the app asked to inject (via document.head.appendChild) — a suite
  // asserts here that, e.g., the xlsx vendor bundle loads only on demand.
  const requested = [];
  const alerts = [];
  // A REAL store. Suites that assert what survives an upload need one; a stub
  // that forgets would let those assertions pass without testing anything.
  const store = new Map(Object.entries(seedStorage));
  // A plain-object VIEW over the same store, for suites written against the
  // `storage["key"]` idiom (read, write, `in`, delete) — every op forwards to
  // the Map, so it and localStorage never fall out of sync.
  const storage = new Proxy(
    {},
    {
      get: (_t, k) => (store.has(k) ? store.get(k) : undefined),
      set: (_t, k, v) => (store.set(k, String(v)), true),
      has: (_t, k) => store.has(k),
      deleteProperty: (_t, k) => (store.delete(k), true),
      // Enumeration traps too, so Object.keys / for…in / spread / JSON.stringify
      // over the view report what the Map actually holds — without these a suite
      // that enumerates instead of indexing sees zero keys and passes falsely.
      ownKeys: () => [...store.keys()],
      getOwnPropertyDescriptor: (_t, k) =>
        store.has(k)
          ? {
              value: store.get(k),
              enumerable: true,
              configurable: true,
              writable: true,
            }
          : undefined,
    },
  );
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
        // Real elements always expose a dataset; a stub without one throws the
        // moment any code reads el.dataset.foo (e.g. the utilization hint).
        dataset: {},
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
        // Named `attrs` to match the context accessibility-affordances-test
        // builds for the pages.
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
    localStorage: storageThrows
      ? {
          getItem: () => {
            throw new Error("private mode");
          },
          setItem: () => {
            throw new Error("private mode");
          },
          // A real private-mode/quota-blocked browser throws on removeItem too,
          // so any clear-a-key path stays exercised under storageThrows.
          removeItem: () => {
            throw new Error("private mode");
          },
        }
      : {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
        },
    // Capture alerts/confirm rather than needing a real window. confirm returns
    // true so a "really delete?" path proceeds; a suite that needs the other
    // branch overrides ctx.confirm.
    alerts,
    alert: (m) => alerts.push(m),
    confirm: () => true,
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
      sel === "script[src]" ? scripts.map((s) => ({ src: s })) : [],
    addEventListener: () => {},
    head: {
      appendChild(script) {
        if (script.tag !== "script") return;
        requested.push(script.src);
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
  for (const s of scripts) load(s);
  for (const f of APP_SCRIPTS) load(f);

  // Capture toasts instead of rendering them
  ctx.showToast = (message, type) => toasts.push({ message, type });

  return { ctx, elements, toasts, store, storage, requested, alerts };
}

/**
 * A minimal, DOM-free vm context for the pure-engine suites. These load only the
 * engine files they name and compute over data the suite injects on the context
 * — there is no page, so none of buildContext's DOM/localStorage/data machinery
 * applies. Returns { ctx, load, run }:
 *   - ctx:  the contextified sandbox; assign fixtures with `ctx.foo = …` and read
 *           globals the loaded code defines as `ctx.RuleEngine`, etc.
 *   - load: run another app file into the same context later (filename = the
 *           repo-relative path, so its BASENAME drives V8 coverage attribution —
 *           the same basename the suite would have used loading it directly).
 *   - run:  evaluate an expression string in the context and return its value.
 *
 * @param {object} [options]
 * @param {string[]} [options.scripts] repo-relative app files to load up front
 * @param {string} [options.label] filename for `run` evals (stack readability only)
 */
function buildEngineContext({ scripts = [], label = "engine-eval" } = {}) {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const load = (rel) =>
    vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
      filename: rel,
    });
  const run = (expr) => vm.runInContext(expr, ctx, { filename: label });
  for (const s of scripts) load(s);
  return { ctx, load, run };
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
  buildEngineContext,
  makeChecker,
  rowsOf,
  headersOf,
  parse,
  confirmMapping,
};
