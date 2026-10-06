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
// Doubled backslashes: in a template literal a single one is dropped, which left the
// dot matching any character, so `xinl-foo {` would satisfy the rule for `inl-foo`.
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const undefinedClasses = [...used].filter(
  (c) => !new RegExp(`\\.${escapeRegExp(c)}\\s*\\{`).test(css),
);
check(
  "every inl- class on a page has a rule in inline-utilities.css",
  used.size > 0 && undefinedClasses.length === 0,
  `used ${used.size}; undefined: ${undefinedClasses.join(", ")}`,
);

// Generated markup in src/ has no style attribute at all. Computed styles travel as
// data-style JSON and are applied through the CSS object model (page-actions.js).
const walkJs = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    return e.isDirectory() ? walkJs(f) : f.endsWith(".js") ? [f] : [];
  });
let styleAttrsInSrc = 0;
for (const f of walkJs(path.join(REPO, "src"))) {
  styleAttrsInSrc += (fs.readFileSync(f, "utf8").match(/ style="/g) || [])
    .length;
}
check(
  "no style attribute remains in src/",
  styleAttrsInSrc === 0,
  `${styleAttrsInSrc} style attributes`,
);

// Generated markup names its utility classes in JS strings, which the page scan above
// never sees: a missing rule there drops a style with nothing failing.
const usedInSrc = new Set();
for (const f of walkJs(path.join(REPO, "src"))) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/\binl-[0-9a-f]{8}\b/g)) {
    usedInSrc.add(m[0]);
  }
}
const undefinedInSrc = [...usedInSrc].filter(
  (c) => !new RegExp(`\\.${escapeRegExp(c)}\\s*\\{`).test(css),
);
check(
  "every inl- class that src/ markup uses has a rule in inline-utilities.css",
  usedInSrc.size > 0 && undefinedInSrc.length === 0,
  `used ${usedInSrc.size}; undefined: ${undefinedInSrc.join(", ")}`,
);

// The pages carry no inline script or style block, and the CSP allows neither
// 'unsafe-inline' nor inline code (slice 5 of phase 5).
const inlineCode = pages.filter((p) => {
  const html = read(p);
  return (
    /<style[\s>]/.test(html) ||
    /<script(?![^>]*\ssrc=)[^>]*>\s*\S/.test(html) ||
    /'unsafe-inline'/.test(html)
  );
});
check(
  "no page has an inline script, an inline style block, or unsafe-inline",
  inlineCode.length === 0,
  inlineCode.join(", "),
);

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("inline-utilities-test: all checks passed");
}
