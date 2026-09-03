// record-schema suite: pins tools/lib/record-schema.js — the shipped record's field
// schema (the 8-decimal price contract, FIELD_ORDER/PRICE_FIELDS and their
// derivations, the emitters) and reading that shape back out of committed data. No
// network.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeChecker } = require("../harness");
const {
  round8,
  loadCommittedRegions,
  readShippedRegionKeys,
  SERVICE,
  FIELD_ORDER,
  PRICE_FIELDS,
  specFields,
  priceFields,
  emitValue,
  emitRecordBody,
} = require("../../../tools/lib/record-schema");

const { check, state } = makeChecker();

// ── round8: the cross-tool price contract ───────────────────────────────────────
{
  check(
    "round8 strips float noise to 8 decimals but keeps an 8-decimal value",
    round8(0.19423600000000002) === 0.194236 &&
      round8(0.12345678) === 0.12345678,
    String(round8(0.19423600000000002)),
  );
  check(
    "round8 passes non-finite through unchanged",
    Number.isNaN(round8(NaN)) && round8(undefined) === undefined,
  );
}

// ── readShippedRegionKeys: real shipped manifests ───────────────────────────────
{
  for (const [name, prefix] of [
    ["aws", "AWS"],
    ["azure", "AZURE"],
    ["gcp", "GCP"],
  ]) {
    const keys = readShippedRegionKeys(name, prefix);
    check(
      `readShippedRegionKeys(${name}) returns the shipped manifest array`,
      Array.isArray(keys) && keys.length > 0,
      `${keys.length} keys`,
    );
  }
  let threw = false;
  try {
    readShippedRegionKeys("aws", "NOPE");
  } catch {
    threw = true;
  }
  check("readShippedRegionKeys throws on a missing prefix manifest", threw);
}

// ── loadCommittedRegions: the old side both refresh diffs read ──────────────────
// Against a throwaway tree, not js/: the point is the malformed case, which the
// shipped region files must never contain.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cir-regions-"));
  const dir = path.join(root, "js", "aws", "regions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "us_east_1.js"),
    'window.us_east_1 = { "m5.large": { vCpus: 2 } };\n',
  );

  const regions = loadCommittedRegions("aws", root);
  check(
    "loadCommittedRegions keys the region records by file name",
    Object.keys(regions).join(",") === "us_east_1" &&
      regions.us_east_1["m5.large"].vCpus === 2,
    JSON.stringify(regions),
  );

  // Guard (plant-RED: drop the assignment check): a region file that sets no global
  // must fail by name here. recommendation-diff carried its own guardless copy of
  // this loader and published the resulting undefined region into the engine's
  // {PREFIX}_REGION_KEYS, where it surfaced far from the file that caused it.
  fs.writeFileSync(path.join(dir, "ghost.js"), "// assigns no global\n");
  let msg = "";
  try {
    loadCommittedRegions("aws", root);
  } catch (e) {
    msg = e.message;
  }
  check(
    "loadCommittedRegions names the region file that assigned no global",
    msg.includes("js/aws/regions/ghost.js") && msg.includes("window.ghost"),
    msg || "(did not throw)",
  );

  fs.rmSync(root, { recursive: true, force: true });
}

// ── loadCommittedRegions rehydrates the specs half ──────────────────────────────
// The tools' twin of the browser's loadRegionData. A region file carries prices only;
// the specs come back from the manifest's {P}_SPECS.compute. Every provider, because
// GCP's two price fields sit at positions 6-7 of 9 — in the MIDDLE of the field order,
// not at the end — so an AWS-only check would pass on a partition that slices
// positionally and silently mangles GCP.
{
  const SPECS = {
    aws: { instanceFamily: "m5", vCpus: 2, memorySizeInGiB: 8 },
    azure: { family: "dv3", vCpus: 2, memoryGiB: 8 },
    gcp: { series: "n2", vCpus: 2, memoryGiB: 8 },
  };
  const PRICES = {
    aws: { onDemandLinuxHr: 0.096, onDemandWindowsHr: 0.188 },
    azure: { linuxPrice: 0.096, windowsPrice: 0.188 },
    gcp: { hourlyPrice: 0.096, windowsHourlyPrice: 0.188 },
  };
  const TYPE = { aws: "m5.large", azure: "d2v3", gcp: "n2-standard-2" };

  // A tree in the shipped two-part shape: manifest with a specs blob, price-only region.
  function splitRoot(
    name,
    { specs = SPECS[name], prices = PRICES[name] } = {},
  ) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cir-rehydrate-"));
    const dir = path.join(root, "js", name, "regions");
    fs.mkdirSync(dir, { recursive: true });
    const P = name.toUpperCase();
    fs.writeFileSync(
      path.join(root, "js", name, `${name}-data.js`),
      `window.${P}_SPECS = { ${SERVICE}: ` +
        `${specs ? JSON.stringify({ [TYPE[name]]: specs }) : "{}"} };\n`,
    );
    fs.writeFileSync(
      path.join(dir, "r1.js"),
      `window.r1 = ${JSON.stringify({ [TYPE[name]]: prices })};\n`,
    );
    return root;
  }

  for (const name of ["aws", "azure", "gcp"]) {
    const root = splitRoot(name);
    // Guarded: a loader that stopped merging trips its OWN price-but-no-specs guard,
    // and an unhandled throw here would unwind the file into a single stack trace
    // instead of three per-provider results — which is how a GCP-only regression
    // would hide behind an AWS one.
    let rec = null;
    let msg = "";
    try {
      rec = loadCommittedRegions(name, root).r1[TYPE[name]];
    } catch (e) {
      msg = e.message;
    }
    const want = { ...SPECS[name], ...PRICES[name] };
    check(
      `[${name}] loadCommittedRegions merges the specs blob back onto the price record`,
      rec !== null && Object.keys(want).every((f) => rec[f] === want[f]),
      msg || JSON.stringify(rec),
    );
    fs.rmSync(root, { recursive: true, force: true });
  }

  // The option-independent guard. A price-only record with NO specs merged is the
  // split's silent failure: every consumer would read undefined vCPUs and quietly drop
  // the type, which reads as a data change rather than as a bug. It must fail by name.
  {
    const root = splitRoot("aws", { specs: null });
    let msg = "";
    try {
      loadCommittedRegions("aws", root);
    } catch (e) {
      msg = e.message;
    }
    check(
      "a record with prices and no specs fails, naming the file, the type and the manifest",
      msg.includes("js/aws/regions/r1.js") &&
        msg.includes("m5.large") &&
        msg.includes("AWS_SPECS.compute"),
      msg || "(did not throw)",
    );
    fs.rmSync(root, { recursive: true, force: true });
  }

  // The twin of the browser loader's half-merge case: a blob entry that lost vCpus
  // merges to a record every consumer drops for failing `vCpus > 0`, which reads as
  // a catalogue change rather than a broken manifest. Keyed on vCpus rather than on
  // "every spec" deliberately — a field newly added to FIELD_ORDER is legitimately
  // absent until the next refresh writes it, and an all-fields guard would break the
  // shipped tree in that window.
  {
    const root = splitRoot("aws", {
      specs: { instanceFamily: "m5", memorySizeInGiB: 8 },
    });
    let msg = "";
    try {
      loadCommittedRegions("aws", root);
    } catch (e) {
      msg = e.message;
    }
    check(
      "a priced record whose specs blob entry lost vCpus fails by name",
      msg.includes("m5.large") && msg.includes("vCpus"),
      msg || "(did not throw)",
    );
    fs.rmSync(root, { recursive: true, force: true });
  }

  // ...and it must NOT fire on the pre-split format, which is what the tree still
  // holds until the conversion lands: fat records, no specs blob to merge. A guard
  // that rejected those would fail every tool on today's committed data.
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cir-rehydrate-"));
    const dir = path.join(root, "js", "aws", "regions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "r1.js"),
      `window.r1 = ${JSON.stringify({ "m5.large": { ...SPECS.aws, ...PRICES.aws } })};\n`,
    );
    let msg = "";
    let rec = null;
    try {
      rec = loadCommittedRegions("aws", root).r1["m5.large"];
    } catch (e) {
      msg = e.message;
    }
    check(
      "a fat pre-split record passes through untouched, specs blob or not",
      msg === "" && rec.vCpus === 2 && rec.onDemandLinuxHr === 0.096,
      msg || JSON.stringify(rec),
    );
    fs.rmSync(root, { recursive: true, force: true });
  }

  // Merge order: the region file wins. A fat record therefore overrides the specs it
  // already agrees with rather than being rewritten by them, which is what makes the
  // merge a no-op on unsplit data instead of a second source of truth.
  {
    const root = splitRoot("aws", {
      prices: { ...PRICES.aws, vCpus: 64 },
    });
    check(
      "a field present in both halves takes the region file's value",
      loadCommittedRegions("aws", root).r1["m5.large"].vCpus === 64,
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ── The record-shape contract: FIELD_ORDER and its specs/prices partition ───────
// fetch-vantage serializes the fat monolith from this list and split-data writes
// both halves from it, so a disagreement here is a field written by one writer and
// dropped by the other. split-data-test drives the partition end to end through
// the real tool, on all three providers; what is pinned here is the arithmetic
// itself — exhaustive, disjoint, order-preserving — so a partition bug is named as
// such rather than arriving as a round-trip failure several layers away.
{
  const PROVIDERS = ["aws", "azure", "gcp"];

  check(
    "every provider declares a field order and a price list",
    PROVIDERS.every(
      (p) => Array.isArray(FIELD_ORDER[p]) && Array.isArray(PRICE_FIELDS[p]),
    ),
    Object.keys(FIELD_ORDER).join(",") +
      " / " +
      Object.keys(PRICE_FIELDS).join(","),
  );

  for (const p of PROVIDERS) {
    const specs = specFields(p);
    const prices = priceFields(p);

    // The partition must be exhaustive and disjoint. Asserting only "specs are
    // the non-price fields" would pass if a field vanished from both halves.
    check(
      `[${p}] specs + prices partition FIELD_ORDER exactly`,
      specs.length + prices.length === FIELD_ORDER[p].length &&
        [...specs, ...prices].sort().join(",") ===
          [...FIELD_ORDER[p]].sort().join(",") &&
        specs.every((f) => !prices.includes(f)),
      `${specs.length} specs + ${prices.length} prices vs ${FIELD_ORDER[p].length} fields`,
    );
    check(
      `[${p}] priceFields returns exactly the declared price fields`,
      prices.join(",") === PRICE_FIELDS[p].join(","),
      prices.join(","),
    );
    // Order matters: a region file's fields should appear in the order they had
    // inside the fat record, so a diff of the two formats stays readable.
    check(
      `[${p}] both halves keep FIELD_ORDER's relative order`,
      specs.join(",") ===
        FIELD_ORDER[p].filter((f) => specs.includes(f)).join(",") &&
        prices.join(",") ===
          FIELD_ORDER[p].filter((f) => prices.includes(f)).join(","),
      `${specs.join(",")} | ${prices.join(",")}`,
    );
    // Every provider prices Linux and Windows separately, and both are the fields
    // that legitimately vary by region. A spec half that captured either would
    // publish one region's price as every region's.
    check(
      `[${p}] exactly two price fields, and no spec field looks like a price`,
      prices.length === 2 && !specs.some((f) => /price|hr$|hourly/i.test(f)),
      `prices=${prices.join(",")} suspicious specs=${specs.filter((f) => /price|hr$|hourly/i.test(f)).join(",")}`,
    );
  }

  // The guard that catches the other direction of drift: a price field renamed in
  // FIELD_ORDER but not in PRICE_FIELDS would otherwise fall out of BOTH halves
  // and be silently dropped from the shipped data. Drive it with a real bad map
  // rather than trusting the branch exists.
  {
    const saved = PRICE_FIELDS.aws.slice();
    PRICE_FIELDS.aws.push("onDemandKlingonHr");
    let msg = null;
    try {
      specFields("aws");
    } catch (err) {
      msg = String(err.message || err);
    }
    PRICE_FIELDS.aws.length = 0;
    PRICE_FIELDS.aws.push(...saved);
    check(
      "a price field absent from FIELD_ORDER is rejected by name",
      msg !== null && msg.includes("onDemandKlingonHr"),
      msg || "did not throw",
    );
    check(
      "and the map was restored, so later checks see the real contract",
      PRICE_FIELDS.aws.join(",") === saved.join(","),
      PRICE_FIELDS.aws.join(","),
    );
  }

  check(
    "an unknown provider is rejected rather than returning an empty partition",
    (() => {
      try {
        specFields("azure-classic");
        return false;
      } catch {
        return true;
      }
    })(),
  );
}

// ── emitValue / emitRecordBody: the serializer both writers share ──────────────
// A non-finite number or an undefined would serialize to a bare NaN/undefined
// token — syntactically valid JavaScript that ships a broken record. The throw is
// the tripwire for a field lost upstream, so pin that it actually fires.
{
  check(
    "emitValue quotes strings and leaves finite numbers bare",
    emitValue("m5") === '"m5"' &&
      emitValue(2) === "2" &&
      emitValue(0) === "0" &&
      emitValue(0.096) === "0.096",
    [emitValue("m5"), emitValue(2), emitValue(0)].join(" "),
  );
  for (const [label, bad] of [
    ["undefined", undefined],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["null", null],
    ["an object", {}],
  ]) {
    let threw = false;
    try {
      emitValue(bad);
    } catch {
      threw = true;
    }
    check(`emitValue refuses ${label}`, threw);
  }

  const rec = { instanceFamily: "m5", vCpus: 2 };
  check(
    "emitRecordBody emits the named fields in the order given, at the default indent",
    emitRecordBody(["instanceFamily", "vCpus"], rec) ===
      '    instanceFamily: "m5",\n    vCpus: 2,',
    JSON.stringify(emitRecordBody(["instanceFamily", "vCpus"], rec)),
  );
  check(
    "emitRecordBody honours a custom indent (the specs blob nests one level deeper)",
    emitRecordBody(["vCpus"], rec, "      ") === "      vCpus: 2,",
    JSON.stringify(emitRecordBody(["vCpus"], rec, "      ")),
  );
  {
    // A field the record lacks must throw, not be skipped: silently emitting a
    // shorter record is exactly the field-level loss the split makes possible.
    let threw = false;
    try {
      emitRecordBody(["vCpus", "memorySizeInGiB"], rec);
    } catch {
      threw = true;
    }
    check("emitRecordBody refuses a record missing a named field", threw);
  }
}

if (state.failures) {
  console.error(`\nrecord-schema: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nrecord-schema: all checks passed");
  process.exitCode = 0;
}
