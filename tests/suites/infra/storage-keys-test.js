// src/shared/storage-keys.js is the single list of localStorage keys the app owns
// (3.21 phase 1). Three things must stay true for the storage manager to be safe
// to build on: the registry is the only place a key string is written, every
// registry entry is actually used, and every page loads the registry before any
// module that reads a key at top level.
const fs = require("fs");
const path = require("path");
const { REPO, buildEngineContext, makeChecker } = require("../harness");

const { run } = buildEngineContext({
  scripts: ["src/shared/storage-keys.js"],
  label: "storage-keys",
});

const { check, state } = makeChecker();

const keys = run("STORAGE_KEYS");
const names = Object.keys(keys);
const values = names.map((n) => keys[n]);

check(
  "registry lists the nine app keys",
  names.length === 9,
  `found ${names.length}: ${names.join(", ")}`,
);
check(
  "every registry value is namespaced to the app",
  values.every((v) => v.startsWith("cloudInstanceRecommender")),
);
check(
  "no two registry entries share a key",
  new Set(values).size === values.length,
);
check("registry is frozen", Object.isFrozen(keys));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
}

const srcFiles = walk(path.join(REPO, "src")).map((p) =>
  path.relative(REPO, p).split(path.sep).join("/"),
);
const registryFile = "src/shared/storage-keys.js";

const literalOutside = [];
const usedKeys = new Set();
for (const rel of srcFiles) {
  const text = fs.readFileSync(path.join(REPO, rel), "utf8");
  if (rel !== registryFile) {
    for (const m of text.matchAll(/"cloudInstanceRecommender[A-Za-z]*"/g)) {
      literalOutside.push(`${rel}: ${m[0]}`);
    }
  }
  for (const m of text.matchAll(/STORAGE_KEYS\.([A-Za-z]+)/g)) {
    usedKeys.add(m[1]);
  }
}

check(
  "no key literal exists outside the registry",
  literalOutside.length === 0,
  literalOutside.join("; "),
);
check(
  "every registry entry is referenced from src",
  names.every((n) => usedKeys.has(n)),
  `unused: ${names.filter((n) => !usedKeys.has(n)).join(", ")}`,
);

const pages = ["aws", "azure", "gcp", "multicloud"];
for (const page of pages) {
  const html = fs.readFileSync(path.join(REPO, `${page}.html`), "utf8");
  const reg = html.indexOf('src="src/shared/storage-keys.js"');
  const rules = html.indexOf('src="src/core/rules/user-rules.js"');
  check(
    `${page}.html loads the registry before user-rules.js`,
    reg !== -1 && rules !== -1 && reg < rules,
    `registry@${reg} user-rules@${rules}`,
  );
}

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("storage-keys-test: all checks passed");
}
