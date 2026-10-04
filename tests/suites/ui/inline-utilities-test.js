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

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("inline-utilities-test: all checks passed");
}
