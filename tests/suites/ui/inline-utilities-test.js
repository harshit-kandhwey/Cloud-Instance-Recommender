// The tool and info pages carry no static style attributes (3.21 phase 5, slice 4).
// Their styles live in styles/inline-utilities.css, and every inl- class a page uses
// must have a rule there, so a removed rule cannot silently drop a style.
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const pages = [
  "aws.html",
  "azure.html",
  "gcp.html",
  "multicloud.html",
  "app-portfolio.html",
  "index.html",
  "user-guide.html",
];
const css = read("styles/inline-utilities.css");

const staticStyles = pages.filter((p) => /\sstyle="/.test(read(p)));
check(
  "no page carries a static style attribute",
  staticStyles.length === 0,
  staticStyles.join(", "),
);

const used = new Set();
for (const p of pages) {
  for (const m of read(p).matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c.startsWith("inl-")) used.add(c);
  }
}
const undefinedClasses = [...used].filter(
  (c) => !new RegExp(`\.${c} \{`).test(css),
);
check(
  "every inl- class on a page has a rule in inline-utilities.css",
  used.size > 0 && undefinedClasses.length === 0,
  `used ${used.size}; undefined: ${undefinedClasses.join(", ")}`,
);

// Generated markup in src/ follows the same rule. Data-driven styles (a computed
// width or colour) cannot be a fixed class yet; they are counted so that adding one
// is a decision, not an accident. Slice 4b-2 moves them.
const walkJs = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    return e.isDirectory() ? walkJs(f) : f.endsWith(".js") ? [f] : [];
  });
let staticInSrc = 0;
let dynamicInSrc = 0;
for (const f of walkJs(path.join(REPO, "src"))) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/ style="([^"]*)"/g)) {
    if (m[1].includes("${")) dynamicInSrc++;
    else staticInSrc++;
  }
}
check(
  "no static style attribute remains in src/",
  staticInSrc === 0,
  `${staticInSrc} static`,
);
const DYNAMIC_STYLES_IN_SRC = 22;
check(
  `data-driven style attributes in src/ stay at ${DYNAMIC_STYLES_IN_SRC} until slice 4b-2`,
  dynamicInSrc === DYNAMIC_STYLES_IN_SRC,
  `found ${dynamicInSrc}`,
);

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("inline-utilities-test: all checks passed");
}
