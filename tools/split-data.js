#!/usr/bin/env node
/*
 * split-data.js — splits each monolithic js/{provider}/{provider}-data.js into a
 * manifest (the same path, rewritten) plus per-region files
 * (js/{provider}/regions/<regionKey>.js).
 *
 * THE TWO-PART FORMAT. A type's SPECS are written once, into the manifest as
 * window.{P}_SPECS.compute[type]; a region file carries that region's PRICES and
 * nothing else. The specs were byte-identical in every region that offered the
 * type, so storing them per region repeated each value 17x over on AWS, 41 on
 * Azure and 38 on GCP. The loaders merge the halves back at read time —
 * loadRegionData in the browser, loadCommittedRegions in the build tools — so
 * nothing above a loader ever sees that the data is stored in two pieces.
 *
 * The `compute` level exists so a later non-compute service can be added without
 * migrating the format a second time. It is the only key today.
 *
 * Data-update workflow:
 *   1. Drop the freshly generated monolithic {provider}-data.js in place
 *      (same format as produced from instances.vantage.sh).
 *   2. Run: node tools/split-data.js
 *   3. Commit the regenerated regions/ files and the manifest.
 *
 * Idempotent: a file that is already a manifest (contains _REGION_KEYS) is
 * skipped, so running the tool twice is safe. The new manifest still declares
 * _REGION_KEYS, so the guard keeps recognising its own output.
 *
 * Hard-fails, all before any disk write, if: the region set in the
 * makeXRegionsGlobal({...}) call does not match the globals the monolith actually
 * assigns; a type's specs disagree between two regions; or the artifacts about to
 * be written do not rebuild the original records exactly.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  ROOT,
  writeFileAtomic,
  specFields,
  priceFields,
  emitRecordBody,
} = require("./lib/util");

const PROVIDERS = [
  { name: "aws", prefix: "AWS" },
  { name: "azure", prefix: "AZURE" },
  { name: "gcp", prefix: "GCP" },
];

// The service level inside {P}_SPECS. Compute is the only one; the level is here
// so adding storage or database later is a new key, not a second migration.
const SERVICE = "compute";

// Run one artifact's source in a fresh window-like sandbox and return the globals.
function evaluate(source, filename) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename });
  return sandbox;
}

function splitProvider({ name, prefix }, root = ROOT) {
  const dataPath = path.join(root, "js", name, `${name}-data.js`);
  if (!fs.existsSync(dataPath)) {
    console.log(`[${name}] ${dataPath} not found — skipping`);
    return { name, skipped: true };
  }

  // Normalize CRLF so the exact-line matching below works regardless of
  // how git checked the file out
  const content = fs.readFileSync(dataPath, "utf8").replace(/\r\n/g, "\n");

  if (content.includes("_REGION_KEYS")) {
    console.log(`[${name}] already a manifest — skipping (idempotency guard)`);
    return { name, skipped: true };
  }

  // Header comments (first lines starting with //) — preserved in manifest
  const headerLines = [];
  for (const line of content.split("\n")) {
    if (line.startsWith("//")) headerLines.push(line);
    else break;
  }

  const dateMatch = content.match(
    new RegExp(`window\\.${prefix}_DATA_DATE = "([^"]+)";`),
  );
  if (!dateMatch) {
    throw new Error(`[${name}] window.${prefix}_DATA_DATE not found`);
  }
  const dataDate = dateMatch[1];

  // The declared region list, read from the makeXRegionsGlobal({...}) call. This
  // stays a text read because it is the one thing worth checking the evaluated
  // result AGAINST: a generator that dropped a region from the call while still
  // emitting its block, or the reverse, is the format drift this guards.
  const callMatch = content.match(/make\w*RegionsGlobal\(\{([\s\S]*?)\}\)/);
  if (!callMatch) {
    throw new Error(`[${name}] makeRegionsGlobal call not found`);
  }
  const declaredKeys = callMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // The block names, by name only — the regex reads `const <key> = {` headers and
  // never the record bodies underneath. This cross-check has to run BEFORE the
  // monolith is evaluated: the call passes its regions as bare identifiers, so a
  // key declared in the call with no matching block throws a bare
  // "eu_west_1 is not defined" at evaluation, which says nothing about what
  // actually drifted. Checking first keeps the precise message.
  const blockKeys = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^const ([A-Za-z_][A-Za-z0-9_]*) = \{$/);
    if (m) blockKeys.push(m[1]);
  }
  if (blockKeys.length !== declaredKeys.length) {
    throw new Error(
      `[${name}] found ${blockKeys.length} region blocks but ` +
        `makeRegionsGlobal declares ${declaredKeys.length} keys — aborting`,
    );
  }
  const blockSet = new Set(blockKeys);
  const missing = declaredKeys.filter((k) => !blockSet.has(k));
  if (missing.length) {
    throw new Error(
      `[${name}] declared but not defined: ${missing.join(", ")}`,
    );
  }

  // Evaluate rather than slice text. The split now has to reason about individual
  // FIELDS rather than whole blocks, and a regex taught to understand record
  // bodies would be the "guard built from a regex" this repo has already paid for
  // twice. The monolith is self-contained — it assigns every region onto window —
  // so running it yields the real records, and a block that no longer parses
  // throws here instead of being silently mis-sliced.
  const sandbox = evaluate(content, `js/${name}/${name}-data.js`);

  const unassigned = declaredKeys.filter(
    (k) => !sandbox[k] || typeof sandbox[k] !== "object",
  );
  if (unassigned.length) {
    throw new Error(
      `[${name}] declared but not assigned onto window: ${unassigned.join(", ")}`,
    );
  }

  // ── Partition every record into its specs half and its prices half ──────────
  const specNames = specFields(name);
  const priceNames = priceFields(name);

  const specs = {}; // type -> spec record, written once
  const specSource = new Map(); // type -> the region that first defined it
  const byRegion = {}; // regionKey -> { type: price record }

  for (const rk of declaredKeys) {
    const out = {};
    for (const type of Object.keys(sandbox[rk]).sort()) {
      const rec = sandbox[rk][type];
      const prior = specs[type];
      if (!prior) {
        const spec = {};
        for (const f of specNames) spec[f] = rec[f];
        specs[type] = spec;
        specSource.set(type, rk);
      } else {
        // Refuse to lose data. data-integrity-test pins that today's catalogue
        // agrees region to region; this is that guard's twin on the writer, so
        // the day a provider ships a genuinely region-varying specification the
        // conversion stops rather than publishing one region's value as though
        // it were every region's — silently, for every user.
        for (const f of specNames) {
          if (prior[f] !== rec[f]) {
            throw new Error(
              `[${name}] ${type}.${f} differs by region: ` +
                `${specSource.get(type)} has ${JSON.stringify(prior[f])}, ` +
                `${rk} has ${JSON.stringify(rec[f])} — specs are stored once per ` +
                `type, so this value cannot be split without loss`,
            );
          }
        }
      }
      const priceRec = {};
      for (const f of priceNames) priceRec[f] = rec[f];
      out[type] = priceRec;
    }
    byRegion[rk] = out;
  }

  // ── Serialize ───────────────────────────────────────────────────────────────
  const specTypes = Object.keys(specs).sort();
  const manifest =
    headerLines.join("\n") +
    (headerLines.length ? "\n" : "") +
    `// Manifest generated by tools/split-data.js — per-region prices live in js/${name}/regions/\n` +
    `// ${prefix}_SPECS holds each type's specifications once; a region file carries prices only.\n` +
    `window.${prefix}_DATA_DATE = "${dataDate}";\n` +
    `window.${prefix}_SPECS = {\n` +
    `  ${SERVICE}: {\n` +
    specTypes
      .map(
        (t) =>
          `    ${JSON.stringify(t)}: {\n` +
          `${emitRecordBody(specNames, specs[t], "      ")}\n` +
          `    },`,
      )
      .join("\n") +
    `\n  },\n};\n` +
    `window.${prefix}_REGION_KEYS = [\n` +
    declaredKeys.map((k) => `  "${k}",`).join("\n") +
    `\n];\n` +
    // Last, and after the specs assignment above: a consumer that polls
    // {P}_DATA_READY must never observe it true while the specs half is missing.
    `window.${prefix}_DATA_READY = true;\n`;

  const files = declaredKeys.map((key) => ({
    key,
    fileContent:
      `// ${prefix} instance prices for region key: ${key} (updated ${dataDate})\n` +
      `// Auto-generated by tools/split-data.js — do not edit by hand\n` +
      `// Specs for these types live in js/${name}/${name}-data.js as ${prefix}_SPECS.${SERVICE}\n` +
      `window.${key} = {\n` +
      Object.keys(byRegion[key])
        .map(
          (t) =>
            `  ${JSON.stringify(t)}: {\n` +
            `${emitRecordBody(priceNames, byRegion[key][t])}\n` +
            `  },`,
        )
        .join("\n") +
      `\n};\n`,
  }));

  // ── Prove the round trip BEFORE any disk write ──────────────────────────────
  // Read back what is about to be written and rebuild every record from the two
  // halves. The old format could only lose a whole block, which unbalanced braces
  // and failed to compile; the two-part format can lose a single FIELD, which
  // compiles perfectly and ships. So the check is no longer "does it parse" but
  // "does it still say the same thing".
  verifyRoundTrip({ name, prefix, manifest, files, sandbox, declaredKeys });

  // Write the new region files FIRST, then prune stale ones not in the new
  // key set — a write-time failure (disk full, interruption) can then never
  // leave regions/ with deleted-but-unreplaced files
  const regionsDir = path.join(root, "js", name, "regions");
  fs.mkdirSync(regionsDir, { recursive: true });
  const newFileNames = new Set(files.map(({ key }) => `${key}.js`));
  for (const { key, fileContent } of files) {
    writeFileAtomic(path.join(regionsDir, `${key}.js`), fileContent);
  }
  const pruned = [];
  for (const stale of fs.readdirSync(regionsDir)) {
    if (stale.endsWith(".js") && !newFileNames.has(stale)) {
      fs.unlinkSync(path.join(regionsDir, stale));
      pruned.push(stale);
    }
  }

  writeFileAtomic(dataPath, manifest);

  console.log(
    `[${name}] split ${declaredKeys.length} regions into js/${name}/regions/ ` +
      `and wrote ${specTypes.length} type specs into the manifest`,
  );
  // A pruned region stays in users' runtime cache: stale-while-revalidate keeps
  // serving the cached copy because revalidating a deleted file 404s. Bumping
  // CACHE in sw.js is the only thing that evicts it — so say so, loudly.
  if (pruned.length) {
    console.log(
      `[${name}] removed ${pruned.length} region file(s) no longer upstream: ${pruned.join(", ")}`,
    );
    console.log(
      `[${name}] ⚠ regions were removed — bump CACHE in sw.js so clients drop the stale copies`,
    );
  }
  return {
    name,
    count: declaredKeys.length,
    types: specTypes.length,
    pruned,
  };
}

// Rebuild every type x region record from the artifacts as written and compare it
// field by field against the record the monolith held. Runs the manifest and the
// region files in one sandbox, exactly as the page loads them.
function verifyRoundTrip({
  name,
  prefix,
  manifest,
  files,
  sandbox,
  declaredKeys,
}) {
  const check = evaluate(manifest, `js/${name}/${name}-data.js`);
  for (const { key, fileContent } of files) {
    vm.runInContext(fileContent, check, { filename: `${key}.js` });
  }
  const rebuiltSpecs = (check[`${prefix}_SPECS`] || {})[SERVICE];
  if (!rebuiltSpecs) {
    throw new Error(
      `[${name}] emitted manifest has no ${prefix}_SPECS.${SERVICE}`,
    );
  }
  for (const rk of declaredKeys) {
    const original = sandbox[rk];
    const prices = check[rk];
    if (!prices) {
      throw new Error(
        `[${name}] emitted region ${rk} assigned no window.${rk}`,
      );
    }
    const origTypes = Object.keys(original).sort();
    const newTypes = Object.keys(prices).sort();
    if (origTypes.length !== newTypes.length) {
      throw new Error(
        `[${name}] region ${rk} round-tripped ${newTypes.length} types, expected ${origTypes.length}`,
      );
    }
    for (const type of origTypes) {
      const spec = rebuiltSpecs[type];
      if (!spec) {
        throw new Error(
          `[${name}] region ${rk} carries ${type} but ${prefix}_SPECS.${SERVICE} has no entry for it`,
        );
      }
      const rebuilt = { ...spec, ...prices[type] };
      for (const f of Object.keys(original[type])) {
        if (rebuilt[f] !== original[type][f]) {
          throw new Error(
            `[${name}] round trip lost ${rk}.${type}.${f}: ` +
              `${JSON.stringify(original[type][f])} became ${JSON.stringify(rebuilt[f])}`,
          );
        }
      }
      for (const f of Object.keys(rebuilt)) {
        if (!(f in original[type])) {
          throw new Error(
            `[${name}] round trip invented ${rk}.${type}.${f} = ${JSON.stringify(rebuilt[f])}`,
          );
        }
      }
    }
  }
}

function main() {
  let failed = false;
  for (const provider of PROVIDERS) {
    try {
      splitProvider(provider);
    } catch (err) {
      failed = true;
      console.error(String(err.message || err));
    }
  }
  process.exit(failed ? 1 : 0);
}

module.exports = { splitProvider, verifyRoundTrip, PROVIDERS, SERVICE };

if (require.main === module) {
  main();
}
