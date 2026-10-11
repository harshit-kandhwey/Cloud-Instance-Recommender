// xlsx-parser-integrity suite: ensureXlsxLoaded must ask what window.XLSX is before
// capturing it as the parser, not take whatever it held when the full build's script
// finished loading. Two vendored bundles define window.XLSX; the styling fork (0.18.5) predates the
// read-path fixes. The isolation suite pins the capture by reading source text; this
// one pins the behaviour: a parser that is the fork, or older than the fixed release,
// or has no readable version, is refused and never becomes the parser.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { REPO, buildContext, makeChecker } = require("../harness");
const { check, state } = makeChecker();

const FULL = "js/vendor/xlsx.full.min.js";
const FORK = "js/vendor/xlsx-js-style.min.js";
const bundle = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

(async () => {
  // ── the predicate, against the real bundles and synthetic versions ──────────────
  {
    const { ctx, run } = buildContext();
    vm.runInContext(bundle(FULL), ctx, { filename: FULL });
    check(
      "the vendored full build is accepted",
      run("xlsxParserIsSafe(XLSX)") === true,
      run("String(XLSX.version)"),
    );
    vm.runInContext(bundle(FORK), ctx, { filename: FORK });
    check(
      "the vendored styling fork is refused",
      run("xlsxParserIsSafe(XLSX)") === false,
      run("String(XLSX.version)"),
    );
    const safe = (lib) => run(`xlsxParserIsSafe(${lib})`);
    check(
      "the first fixed release is accepted",
      safe(`{ read() {}, version: "0.20.2" }`) === true,
    );
    check(
      "a later minor and a later major are accepted",
      safe(`{ read() {}, version: "0.21.0" }`) === true &&
        safe(`{ read() {}, version: "1.0.0" }`) === true,
    );
    check(
      "a release before the fix is refused",
      safe(`{ read() {}, version: "0.20.1" }`) === false &&
        safe(`{ read() {}, version: "0.19.9" }`) === false,
    );
    check(
      "a fork marker refuses a build whatever its version says",
      safe(`{ read() {}, version: "9.9.9", style_version: "1.2.0" }`) === false,
    );
    check(
      "a missing, partial or unreadable version fails closed",
      safe(`{ read() {} }`) === false &&
        safe(`{ read() {}, version: "0.20" }`) === false &&
        safe(`{ read() {}, version: "latest" }`) === false &&
        safe(`{ read() {}, version: 0.202 }`) === false,
    );
    check(
      "nothing, or an object with no read(), is refused",
      safe("null") === false &&
        safe("undefined") === false &&
        safe(`{ version: "0.20.3" }`) === false,
    );
  }

  // ── the loader, with the script load stubbed ────────────────────────────────────
  async function load(withBundle) {
    const { ctx, run } = buildContext();
    vm.runInContext(
      `window._xlsxParser = undefined; window._xlsxLoadPromise = null;`,
      ctx,
    );
    vm.runInContext(bundle(withBundle), ctx, { filename: withBundle });
    // The "script" finishes loading on the next microtask, as a real load is never
    // synchronous: the loader assigns its promise after the executor returns.
    run(`document.head.appendChild = function (script) {
      Promise.resolve().then(() => script.onload());
    }`);
    let outcome;
    try {
      await run("ensureXlsxLoaded()");
      outcome = { ok: true };
    } catch (e) {
      outcome = { ok: false, message: String(e && e.message) };
    }
    return {
      ...outcome,
      captured: run(
        "window._xlsxParser === window.XLSX && !!window._xlsxParser",
      ),
      promiseCleared: run("window._xlsxLoadPromise === null"),
    };
  }
  {
    const r = await load(FULL);
    check(
      "the full build resolves and is captured as the parser",
      r.ok && r.captured === true,
      JSON.stringify(r),
    );
  }
  {
    const r = await load(FORK);
    check(
      "a fork left in window.XLSX rejects with the integrity error",
      r.ok === false && /integrity check/.test(r.message),
      JSON.stringify(r),
    );
    check(
      "and is never captured as the parser",
      r.captured === false,
      JSON.stringify(r),
    );
    check(
      "and a later attempt is allowed to retry",
      r.promiseCleared === true,
      JSON.stringify(r),
    );
  }

  if (state.failures) {
    console.error(`\nxlsx-parser-integrity: ${state.failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("\nxlsx-parser-integrity: all checks passed");
    process.exitCode = 0;
  }
})();
