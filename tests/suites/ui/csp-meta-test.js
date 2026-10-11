// csp-meta suite: the Content-Security-Policy is delivered in a <meta>, and a meta
// policy only governs what the parser meets AFTER it. js/pwa-register.js was loaded two
// lines before the policy on every page, so the one script that registers the service
// worker ran outside it. Covered, on all seven pages: the policy is present exactly
// once, nothing that loads a resource precedes it, it is the same policy everywhere,
// and it keeps the directives the rest of the product relies on (no inline script or
// style, no connections, no plugins, no foreign base or form target).
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const PAGES = [
  "app-portfolio.html",
  "aws.html",
  "azure.html",
  "gcp.html",
  "index.html",
  "multicloud.html",
  "user-guide.html",
];
const read = (f) =>
  fs.readFileSync(path.join(REPO, f), "utf8").split("\r\n").join("\n");

const REQUIRED = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
];
const FORBIDDEN = ["'unsafe-inline'", "'unsafe-eval'", "http:", "https:", "*"];

const policies = new Map();
for (const page of PAGES) {
  const text = read(page);
  const metas = [
    ...text.matchAll(
      /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/>/g,
    ),
  ];
  check(
    `${page}: exactly one policy meta`,
    metas.length === 1,
    String(metas.length),
  );
  if (metas.length !== 1) continue;
  policies.set(page, metas[0][1]);
  const before = text.slice(0, metas[0].index);
  const loaders = [
    ...before.matchAll(/<(script|link|img|iframe|object|embed|style|base)\b/gi),
  ].map((m) => m[1].toLowerCase());
  check(
    `${page}: nothing that loads a resource comes before the policy`,
    loaders.length === 0,
    loaders.join(", "),
  );
  check(
    `${page}: the policy sits inside <head>`,
    text.indexOf("<head>") !== -1 && text.indexOf("<head>") < metas[0].index,
  );
  const policy = metas[0][1];
  const missing = REQUIRED.filter((d) => !policy.includes(d));
  check(
    `${page}: the policy keeps its required directives`,
    missing.length === 0,
    missing.join("; "),
  );
  const bad = FORBIDDEN.filter((d) => policy.split(/[\s;]+/).includes(d));
  check(
    `${page}: the policy allows nothing broad`,
    bad.length === 0,
    bad.join(" "),
  );
  check(
    `${page}: the service-worker registration still loads`,
    /<script defer src="js\/pwa-register\.js"><\/script>/.test(
      text.slice(metas[0].index),
    ),
  );
}
check(
  "all seven pages carry the same policy",
  new Set(policies.values()).size === 1 && policies.size === PAGES.length,
  [...new Set(policies.values())].join(" | "),
);

if (state.failures) {
  console.error(`\ncsp-meta: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\ncsp-meta: all checks passed");
  process.exitCode = 0;
}
