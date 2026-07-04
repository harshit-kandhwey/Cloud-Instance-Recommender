// Step 8 verification: token coverage + boot script behavior.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..");
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else { failures++; console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`); }
}
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

console.log("[token coverage]");
{
  const themeCss = read("css/theme.css");
  const defined = new Set([...themeCss.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  // user-guide defines its own tokens in its embedded style block
  const guide = read("user-guide.html");
  const guideDefined = new Set([...guide.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((m) => m[1]));

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
  "js/base/downloads.js",
    "aws.html",
    "azure.html",
    "gcp.html",
    "multicloud.html",
    "index.html",
  ];
  let missing = [];
  for (const f of filesSharedTokens) {
    const used = [...read(f).matchAll(/var\(--([a-z0-9-]+)[,)]/gi)].map((m) => m[1]);
    for (const u of used) if (!defined.has(u)) missing.push(`${f}: --${u}`);
  }
  check("all shared var() references defined in theme.css", missing.length === 0, missing.join(", "));

  const guideUsed = [...guide.matchAll(/var\(--([a-z0-9-]+)[,)]/gi)].map((m) => m[1]);
  const guideMissing = guideUsed.filter((u) => !guideDefined.has(u));
  check("user-guide var() references self-contained", guideMissing.length === 0, guideMissing.join(", "));

  // Every :root token should have a [data-theme="dark"] counterpart or be
  // intentionally theme-invariant (brand/action tokens)
  const invariant = new Set([
    "primary", "primary-strong", "primary-2", "accent", "accent-2",
    "grad-primary", "grad-progress", "grad-header", "grad-accent",
    "table-head-text",
  ]);
  const rootBlock = themeCss.split('[data-theme="dark"]')[0];
  const darkBlock = themeCss.split('[data-theme="dark"]')[1] || "";
  const rootTokens = [...rootBlock.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((m) => m[1]);
  const darkTokens = new Set([...darkBlock.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  const unthemed = rootTokens.filter((t) => !darkTokens.has(t) && !invariant.has(t));
  check("every themed token has a dark value", unthemed.length === 0, unthemed.join(", "));
}

console.log("[page wiring]");
{
  for (const f of ["index.html", "aws.html", "azure.html", "gcp.html", "multicloud.html"]) {
    const c = read(f);
    check(`${f}: theme.css linked before page css`, c.indexOf("css/theme.css") !== -1 && c.indexOf("css/theme.css") < c.indexOf(f === "index.html" ? "css/index_style.css" : "css/style.css"));
    check(`${f}: boot script + toggle present`, c.includes("cloudInstanceRecommenderTheme") && c.includes('id="themeToggle"'));
  }
  const g = read("user-guide.html");
  check("user-guide: boot script + toggle present", g.includes("cloudInstanceRecommenderTheme") && g.includes('id="themeToggle"'));
  check("user-guide: dark overrides screen-scoped", /@media screen\s*\{[\s\S]*\[data-theme="dark"\]/.test(g));
}

console.log("[boot script behavior]");
{
  const html = read("aws.html");
  const m = html.match(/<script>\s*\/\/ Set theme before first paint[\s\S]*?<\/script>/);
  check("boot script extracted", !!m);
  const src = m[0].replace(/<\/?script>/g, "");

  function runBoot({ stored, osDark, storageThrows }) {
    const listeners = [];
    const storage = {};
    if (stored != null) storage.cloudInstanceRecommenderTheme = stored;
    const sandbox = {
      document: { documentElement: { dataset: {} }, getElementById: () => null },
      localStorage: storageThrows
        ? { getItem: () => { throw new Error("private"); }, setItem: () => { throw new Error("private"); } }
        : {
            getItem: (k) => (k in storage ? storage[k] : null),
            setItem: (k, v) => { storage[k] = String(v); },
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

  let r = runBoot({ stored: null, osDark: true });
  check("no saved pref + OS dark → dark", r.sandbox.document.documentElement.dataset.theme === "dark");
  r.listeners[0]({ matches: false });
  check("follows OS change while unset", r.sandbox.document.documentElement.dataset.theme === "light");

  r = runBoot({ stored: "light", osDark: true });
  check("saved light beats OS dark", r.sandbox.document.documentElement.dataset.theme === "light");
  r.listeners[0]({ matches: true });
  check("OS change ignored once saved", r.sandbox.document.documentElement.dataset.theme === "light");

  r = runBoot({ stored: null, osDark: false });
  r.ctx.toggleTheme();
  check("toggle light→dark", r.sandbox.document.documentElement.dataset.theme === "dark");
  check("toggle persists choice", r.storage.cloudInstanceRecommenderTheme === "dark");
  r.ctx.toggleTheme();
  check("toggle back to light", r.sandbox.document.documentElement.dataset.theme === "light" && r.storage.cloudInstanceRecommenderTheme === "light");

  r = runBoot({ stored: null, osDark: true, storageThrows: true });
  check("private mode: still themes from OS", r.sandbox.document.documentElement.dataset.theme === "dark");
  r.ctx.toggleTheme();
  check("private mode: toggle still works", r.sandbox.document.documentElement.dataset.theme === "light");
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
  for (const f of ["index.html", "azure.html", "gcp.html", "multicloud.html", "user-guide.html"]) {
    if (extract(f) !== ref) { allSame = false; console.error(`  differs: ${f}`); }
  }
  check("identical boot script everywhere", allSame && ref !== null);
}

process.exit(failures ? 1 : 0);
