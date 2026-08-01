// Dark-mode theme tokens: token coverage + boot script behavior.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..", "..");
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

console.log("[token coverage]");
{
  const themeCss = read("css/theme.css");
  const defined = new Set(
    [...themeCss.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((m) => m[1]),
  );
  // user-guide defines its own tokens in its embedded style block
  const guide = read("user-guide.html");
  const guideDefined = new Set(
    [...guide.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((m) => m[1]),
  );

  const filesSharedTokens = [
    "css/style.css",
    "css/index_style.css",
    "js/base/app-core.js",
    "js/base/ui-shell.js",
    "js/base/ingest.js",
    "js/base/manual-entry.js",
    "js/base/form-controls.js",
    "js/base/generate.js",
    "js/base/preview.js",
    "js/base/charts.js",
    "js/base/downloads.js",
    "aws.html",
    "azure.html",
    "gcp.html",
    "multicloud.html",
    "index.html",
  ];
  let missing = [];
  for (const f of filesSharedTokens) {
    // \s* around the token: var(--foo ) and var(--foo\n) are valid references,
    // and a bare [,)] would skip them — silently leaving an undefined token
    // unvalidated.
    const used = [...read(f).matchAll(/var\(\s*--([a-z0-9-]+)\s*[,)]/gi)].map(
      (m) => m[1],
    );
    for (const u of used) if (!defined.has(u)) missing.push(`${f}: --${u}`);
  }
  check(
    "all shared var() references defined in theme.css",
    missing.length === 0,
    missing.join(", "),
  );

  const guideUsed = [...guide.matchAll(/var\(\s*--([a-z0-9-]+)\s*[,)]/gi)].map(
    (m) => m[1],
  );
  const guideMissing = guideUsed.filter((u) => !guideDefined.has(u));
  check(
    "user-guide var() references self-contained",
    guideMissing.length === 0,
    guideMissing.join(", "),
  );

  // Every :root token should have a [data-theme="dark"] counterpart or be
  // intentionally theme-invariant (brand/action tokens)
  const invariant = new Set([
    "primary",
    "primary-strong",
    "primary-2",
    "accent",
    "accent-2",
    "grad-primary",
    "grad-progress",
    "grad-header",
    "grad-accent",
    "table-head-text",
  ]);
  // Scan by rule body, not by a leading/trailing slice, so the order and count
  // of :root and [data-theme="dark"] rules cannot fool this: a token counts as
  // themed only when it is declared inside a dark rule, and EVERY :root token
  // wherever it sits must have one. theme.css already has two dark blocks, and a
  // :root added after the first would otherwise slip past the old slice.
  const tokensIn = (re) =>
    [...themeCss.matchAll(re)].flatMap((m) =>
      [...m[1].matchAll(/--([a-z0-9-]+)\s*:/gi)].map((x) => x[1]),
    );
  const rootTokens = tokensIn(/:root\s*\{([^}]*)\}/g);
  const darkTokens = new Set(tokensIn(/\[data-theme="dark"\]\s*\{([^}]*)\}/g));
  const unthemed = rootTokens.filter(
    (t) => !darkTokens.has(t) && !invariant.has(t),
  );
  check(
    "every themed token has a dark value",
    unthemed.length === 0,
    unthemed.join(", "),
  );
}

console.log("[page wiring]");
{
  for (const f of [
    "index.html",
    "aws.html",
    "azure.html",
    "gcp.html",
    "multicloud.html",
  ]) {
    const c = read(f);
    check(
      `${f}: theme.css linked before page css`,
      c.indexOf("css/theme.css") !== -1 &&
        c.indexOf("css/theme.css") <
          c.indexOf(
            f === "index.html" ? "css/index_style.css" : "css/style.css",
          ),
    );
    check(
      `${f}: boot script + toggle present`,
      c.includes("cloudInstanceRecommenderTheme") &&
        c.includes('id="themeToggle"'),
    );
  }
  const g = read("user-guide.html");
  check(
    "user-guide: boot script + toggle present",
    g.includes("cloudInstanceRecommenderTheme") &&
      g.includes('id="themeToggle"'),
  );
  // Selector must appear inside the @media screen block, not merely after it.
  // A `[^}]*` regex only matches when the dark selector is the FIRST rule in the
  // media block — reordering unrelated CSS before it would break this with a
  // misleading failure. Brace-scan the block instead, so the check is faithful to
  // "the selector is somewhere inside @media screen", wherever it sits.
  const mediaStart = g.indexOf("@media screen");
  // Start the scan at the block's opening brace. If there is no `{` after the
  // at-rule (a malformed or renamed block), braceStart is -1 and we skip the
  // scan entirely — starting the loop at -1 would count braces from index 0 and
  // fabricate a bogus screenBlock rather than leaving it empty.
  const braceStart = mediaStart === -1 ? -1 : g.indexOf("{", mediaStart);
  let screenBlock = "";
  if (braceStart !== -1) {
    let depth = 0;
    for (let i = braceStart; i < g.length; i++) {
      if (g[i] === "{") depth++;
      else if (g[i] === "}" && --depth === 0) {
        screenBlock = g.slice(mediaStart, i + 1);
        break;
      }
    }
  }
  check(
    "user-guide: dark overrides screen-scoped",
    screenBlock.includes('[data-theme="dark"]'),
  );
}

console.log("[boot script behavior]");
{
  const html = read("aws.html");
  const m = html.match(
    /<script>\s*\/\/ Set theme before first paint[\s\S]*?<\/script>/,
  );
  check("boot script extracted", !!m);
  // Bail cleanly if the marker changed: m[0] would throw and abort the whole
  // block — including the cross-page consistency check below — turning one
  // failure into a stack trace that hides the rest of the suite.
  if (!m) {
    console.error("  boot script not found — skipping behaviour checks");
  } else {
    const src = m[0].replace(/<\/?script>/g, "");

    function runBoot({ stored, osDark, storageThrows }) {
      const listeners = [];
      const storage = {};
      if (stored != null) storage.cloudInstanceRecommenderTheme = stored;
      const sandbox = {
        document: {
          documentElement: { dataset: {} },
          getElementById: () => null,
        },
        localStorage: storageThrows
          ? {
              getItem: () => {
                throw new Error("private");
              },
              setItem: () => {
                throw new Error("private");
              },
            }
          : {
              getItem: (k) => (k in storage ? storage[k] : null),
              setItem: (k, v) => {
                storage[k] = String(v);
              },
            },
      };
      sandbox.window = sandbox;
      sandbox.window.matchMedia = () => ({
        matches: osDark,
        addEventListener: (t, fn) => listeners.push(fn),
      });
      const ctx = vm.createContext(sandbox);
      vm.runInContext(src, ctx);
      return { ctx, sandbox, listeners, storage };
    }

    // Fire the registered OS-change listener, or report it never registered — a
    // boot script that switched to addListener (or registered conditionally)
    // would otherwise throw on listeners[0] and abort the remaining checks, the
    // same crash-vs-clean-failure concern this file guards elsewhere.
    const fireOsChange = (rb, matches) => {
      if (typeof rb.listeners[0] !== "function") return false;
      rb.listeners[0]({ matches });
      return true;
    };

    let r = runBoot({ stored: null, osDark: true });
    check(
      "no saved pref + OS dark → dark",
      r.sandbox.document.documentElement.dataset.theme === "dark",
    );
    check("OS change listener registered", fireOsChange(r, false));
    check(
      "follows OS change while unset",
      r.sandbox.document.documentElement.dataset.theme === "light",
    );

    r = runBoot({ stored: "light", osDark: true });
    check(
      "saved light beats OS dark",
      r.sandbox.document.documentElement.dataset.theme === "light",
    );
    check("OS change listener registered (saved case)", fireOsChange(r, true));
    check(
      "OS change ignored once saved",
      r.sandbox.document.documentElement.dataset.theme === "light",
    );

    // Route every toggle through this: if the boot script stops exporting a
    // global toggleTheme, or the call throws under storageThrows, that becomes
    // one named FAIL instead of a TypeError that skips the cross-page checks.
    const callToggle = (rb) => {
      if (typeof rb.ctx.toggleTheme !== "function") return "not a function";
      try {
        rb.ctx.toggleTheme();
        return null;
      } catch (e) {
        return e.message;
      }
    };

    r = runBoot({ stored: null, osDark: false });
    check("toggleTheme is callable", callToggle(r) === null);
    check(
      "toggle light→dark",
      r.sandbox.document.documentElement.dataset.theme === "dark",
    );
    check(
      "toggle persists choice",
      r.storage.cloudInstanceRecommenderTheme === "dark",
    );
    callToggle(r);
    check(
      "toggle back to light",
      r.sandbox.document.documentElement.dataset.theme === "light" &&
        r.storage.cloudInstanceRecommenderTheme === "light",
    );

    r = runBoot({ stored: null, osDark: true, storageThrows: true });
    check(
      "private mode: still themes from OS",
      r.sandbox.document.documentElement.dataset.theme === "dark",
    );
    callToggle(r);
    check(
      "private mode: toggle still works",
      r.sandbox.document.documentElement.dataset.theme === "light",
    );
  }
}

console.log("[boot scripts identical on all 6 pages]");
{
  const extract = (f) => {
    // Compare content, not line-ending style (formatters vary CRLF/LF)
    const m = read(f)
      .replace(/\r\n/g, "\n")
      .match(/<script>\s*\/\/ Set theme before first paint[\s\S]*?<\/script>/);
    return m ? m[0] : null;
  };
  const ref = extract("aws.html");
  let allSame = true;
  for (const f of [
    "index.html",
    "azure.html",
    "gcp.html",
    "multicloud.html",
    "user-guide.html",
  ]) {
    if (extract(f) !== ref) {
      allSame = false;
      console.error(`  differs: ${f}`);
    }
  }
  check("identical boot script everywhere", allSame && ref !== null);
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout
// when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = failures ? 1 : 0;
