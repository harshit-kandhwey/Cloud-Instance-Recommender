// Exercises the browser-only lazy-load path with a simulated <script> loader:
// document.head.appendChild reads script.src from the repo and executes it in
// the same VM context, then fires onload (onerror if the file is missing).
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..", "..", "..");
const requestedSrcs = [];

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  alert: () => {},
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};
sandbox.window = sandbox;
sandbox.document = {
  createElement: (tag) => ({ tag }),
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: { appendChild: () => {}, removeChild: () => {} },
  head: {
    appendChild(script) {
      requestedSrcs.push(script.src);
      setTimeout(() => {
        try {
          const code = fs.readFileSync(path.join(REPO, script.src), "utf8");
          vm.runInContext(code, ctx, { filename: script.src });
          script.onload && script.onload();
        } catch (e) {
          script.onerror && script.onerror(e);
        }
      }, 0);
    },
  },
};
const ctx = vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(REPO, rel), "utf8"), ctx, {
    filename: rel,
  });
}

// Manifests + code only — NO region files preloaded
for (const p of ["aws", "azure", "gcp"]) load(`js/${p}/${p}-data.js`);
for (const f of [
  "js/base/rule-engine.js",
  "js/base/base-instance-selector.js",
  "js/aws/aws-instance-selector.js",
  "js/azure/azure-instance-selector.js",
  "js/gcp/gcp-instance-selector.js",
  "js/base/instance-selector-factory.js",
])
  load(f);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

// Stalled-promise guard: fail by default, cleared to `failures ? 1 : 0` only
// when the IIFE runs to completion. If an awaited load never settles the event
// loop drains and Node exits — without this that silent stall would exit 0.
process.exitCode = 1;
(async () => {
  console.log("[manifest keys]");
  const aws = ctx.InstanceSelectorFactory.createSelector("aws");
  const azure = ctx.InstanceSelectorFactory.createSelector("azure");
  const gcp = ctx.InstanceSelectorFactory.createSelector("gcp");
  console.log(
    `  counts: aws=${aws.getAllAvailableRegionKeys().length}, azure=${azure.getAllAvailableRegionKeys().length}, gcp=${gcp.getAllAvailableRegionKeys().length}`,
  );
  check("aws manifest keys usable", aws.getAllAvailableRegionKeys().length > 0);
  check(
    "azure returns display names",
    azure.getAllAvailableRegionKeys().includes("East US"),
  );
  check(
    "gcp returns dash keys",
    gcp.getAllAvailableRegionKeys().includes("us-central1"),
  );

  // getAllAvailableRegionKeys feeds the manual-entry autocomplete, while the
  // region chips validate straight against the manifest. AWS filters through a
  // HARDCODED region list and Azure through a hardcoded display-name map, so a
  // data refresh that adds a region silently drops it from autocomplete while
  // the chips still accept it. Fail here instead: the two must offer the same
  // set of regions.
  console.log("[autocomplete covers every manifest region]");
  for (const [name, selector] of [
    ["aws", aws],
    ["azure", azure],
    ["gcp", gcp],
  ]) {
    const manifest = ctx.window[`${name.toUpperCase()}_REGION_KEYS`];
    // Guard the global before filtering it: a rename or a load regression makes
    // it undefined, and `undefined.filter(...)` would crash opaquely instead of
    // reporting which provider's manifest went missing.
    check(
      `${name}: manifest region-keys global is present and non-empty`,
      Array.isArray(manifest) && manifest.length > 0,
      `typeof=${typeof manifest}, length=${manifest && manifest.length}`,
    );
    if (!Array.isArray(manifest) || manifest.length === 0) continue;
    const offered = new Set(
      selector
        .getAllAvailableRegionKeys()
        .map((r) => selector.normalizeRegionForJS(r)),
    );
    const missing = manifest.filter((key) => !offered.has(key));
    check(
      `${name}: every manifest region is offered for autocomplete`,
      missing.length === 0,
      `${missing.length} missing — add them to the hardcoded list in js/${name}/${name}-instance-selector.js: ${missing.slice(0, 10).join(", ")}`,
    );

    // The other direction: a hardcoded entry for a region the manifest no longer
    // has would offer a region nothing can load. Today the selectors filter by
    // the manifest so this cannot happen — assert it so a refactor that drops
    // that filter is caught rather than silently offering dead regions.
    const manifestKeys = new Set(manifest);
    const stale = [...offered].filter((key) => !manifestKeys.has(key));
    check(
      `${name}: no region is offered that the manifest does not have`,
      stale.length === 0,
      `${stale.length} stale — remove them from the hardcoded list in js/${name}/${name}-instance-selector.js: ${stale.slice(0, 10).join(", ")}`,
    );
  }

  console.log("[lazy inject: known regions]");
  check("us_east_1 not on window before load", ctx.us_east_1 === undefined);
  await aws.loadInstanceData(new Set(["us-east-1"]));
  check("aws us-east-1 injected", typeof ctx.us_east_1 === "object");
  check(
    "aws instances parsed",
    (aws.instanceData["us-east-1"] || []).length > 100,
    `got ${(aws.instanceData["us-east-1"] || []).length}`,
  );
  check("aws region marked loaded", aws.loadedRegions.has("aws-us-east-1"));

  await azure.loadInstanceData(new Set(["East US"]));
  check("azure East US → eastus injected", typeof ctx.eastus === "object");
  check(
    "azure instances parsed",
    (azure.instanceData["East US"] || []).length > 100,
  );

  await gcp.loadInstanceData(new Set(["us-central1-a"]));
  check(
    "gcp zone suffix stripped → us_central1",
    typeof ctx.us_central1 === "object",
  );
  check(
    "gcp instances parsed",
    (gcp.instanceData["us-central1-a"] || []).length > 50,
  );

  console.log("[unknown region → fallback, no 404]");
  const before = requestedSrcs.length;
  await aws.loadRegionData("xx-fake-9");
  check(
    "no script request for unknown region",
    requestedSrcs.length === before,
    `requested: ${requestedSrcs.slice(before).join(", ")}`,
  );
  check(
    "fallback data parsed",
    (aws.instanceData["xx-fake-9"] || []).length > 0,
  );
  check("fallback NOT marked loaded", !aws.loadedRegions.has("aws-xx-fake-9"));

  console.log("[dedupe]");
  const aws2 = ctx.InstanceSelectorFactory.createSelector("aws");
  const beforeDedupe = requestedSrcs.length;
  await Promise.all([
    aws2._injectRegionScript("us_west_2"),
    aws2._injectRegionScript("us_west_2"),
    aws._injectRegionScript("us_west_2"),
  ]);
  const newReqs = requestedSrcs.slice(beforeDedupe);
  check(
    "3 concurrent requests → 1 script tag",
    newReqs.length === 1,
    `got ${newReqs.length}`,
  );

  // Swap the sandbox's console.error for the duration of fn, capturing what it was
  // called with. _mergeSpecs reports a broken manifest entry this way now (not by
  // throwing — see the merge-guard block below), so this is how the report is read.
  function capturingConsoleError(fn) {
    const original = sandbox.console.error;
    const lines = [];
    sandbox.console.error = (...args) => lines.push(args.join(" "));
    try {
      return { result: fn(), lines };
    } finally {
      sandbox.console.error = original;
    }
  }

  // ── The specs half is merged back at read time ──────────────────────────────
  // The browser twin of loadCommittedRegions. A region file carries prices only and
  // {P}_SPECS.compute holds each type's specifications once; the loader rejoins them
  // so nothing above it sees the split. All three providers, because GCP's two price
  // fields sit in the MIDDLE of its field order while AWS and Azure end on theirs.
  console.log("[specs rehydration]");
  for (const [name, selector, prefix, type, priceField, specField] of [
    ["aws", aws, "AWS", "m5.large", "onDemandLinuxHr", "vCpus"],
    ["azure", azure, "AZURE", "d2sv5", "linuxPrice", "vCpus"],
    ["gcp", gcp, "GCP", "n2-standard-2", "hourlyPrice", "vCpus"],
  ]) {
    const saved = ctx.window[`${prefix}_SPECS`];
    ctx.window[`${prefix}_SPECS`] = {
      compute: {
        [type]: { [specField]: 99, memoryGiB: 42, memorySizeInGiB: 42 },
      },
    };
    let merged = null;
    let msg = "";
    try {
      merged = selector._mergeSpecs({ [type]: { [priceField]: 1.5 } }, "r1");
    } catch (e) {
      msg = e.message;
    }
    check(
      `${name}: the price record gains its specifications`,
      merged !== null &&
        merged[type][specField] === 99 &&
        merged[type][priceField] === 1.5,
      msg || JSON.stringify(merged),
    );

    // Spread order: the region file wins. That is what makes the merge a no-op on a
    // fat record — the pre-split format, and a stale cached region file served to a
    // client that already has the new loader.
    const fat = selector._mergeSpecs(
      { [type]: { [specField]: 7, [priceField]: 1.5 } },
      "r1",
    );
    check(
      `${name}: a fat record overrides the specs blob rather than being rewritten`,
      fat[type][specField] === 7,
      JSON.stringify(fat[type]),
    );

    // The guard. A price with no specifications means nothing merged; isValidInstance
    // would drop the type exactly as if it were unpriced, so the loss would read as a
    // catalogue change. It must say so instead — by NAMING the broken type and
    // excluding IT ALONE, not by taking the whole region down. A throw here is
    // caught by loadRegionData's try/catch, which replaces the ENTIRE region with
    // sample data — a review finding on this exact code (2026-09-03): one bad
    // manifest entry used to disable a whole region's real data for every user.
    // console.error is strictly louder (visible in devtools, same as a throw) and
    // strictly narrower (only the one type is lost) than the throw it replaced.
    const { result: guarded, lines: guardLines } = capturingConsoleError(() =>
      selector._mergeSpecs(
        { "zz.unknown": { [priceField]: 1.5 }, [type]: { [priceField]: 1.5 } },
        "r1",
      ),
    );
    check(
      `${name}: a priced type absent from the specs blob is excluded, by name`,
      !("zz.unknown" in guarded) &&
        guardLines.some(
          (l) => l.includes("zz.unknown") && l.includes("no specifications"),
        ),
      JSON.stringify({ guarded, guardLines }),
    );
    check(
      `${name}: and the REST of the region still merges normally`,
      guarded[type] && guarded[type][priceField] === 1.5,
      JSON.stringify(guarded),
    );

    // The same guard for a machine sold ONLY with Windows. isValidInstance accepts a
    // type priced for either OS, so a Linux-only guard would wave a Windows-only
    // record straight through into the silent drop it exists to prevent. The two
    // must widen together — this guard was written when validity meant a Linux
    // price, and OS-aware pricing moved that line. u-6tb1.metal is the real machine:
    // no published Linux rate in any region, Windows priced everywhere.
    const { result: winGuarded, lines: winLines } = capturingConsoleError(() =>
      selector._mergeSpecs(
        {
          "zz.winonly": { [selector.getFieldMappings().priceWindows]: 20.6 },
        },
        "r1",
      ),
    );
    check(
      `${name}: a WINDOWS-only priced type absent from the specs blob is also excluded, by name`,
      !("zz.winonly" in winGuarded) &&
        winLines.some(
          (l) => l.includes("zz.winonly") && l.includes("no specifications"),
        ),
      JSON.stringify({ winGuarded, winLines }),
    );

    // The guard's other side, which had no test until a plant walked straight
    // through an over-broad version of it. A record with NO price is not the split's
    // failure mode — there is nothing to lose, because an unpriced type is dropped by
    // design — so it must pass through quietly. Widening the price test is one edit
    // away from `true &&`, and that version throws on data the loader must accept,
    // breaking a whole region rather than one type.
    let inertMsg = "";
    let inert = null;
    try {
      inert = selector._mergeSpecs(
        { "zz.nopriceatall": { someField: 1 } },
        "r1",
      );
    } catch (e) {
      inertMsg = e.message;
    }
    check(
      `${name}: a record with NO price and no specs passes through, it does not throw`,
      inert !== null && inert["zz.nopriceatall"].someField === 1,
      inertMsg || JSON.stringify(inert),
    );

    // HALF-merged is as fatal as unmerged, and looks healthier — which is why it
    // shipped. parseData coerces the absent field to 0 and isValidInstance drops the
    // type for failing `> 0`, so a record with vCPUs but no memory vanishes just as
    // quietly as one with neither. The guard must be OR across the two fields; the
    // AND it was written with passes a blob entry that lost one of them.
    const map = selector.getFieldMappings();
    for (const half of [map.vCpus, map.memory]) {
      const partial = { [specField]: 99, memoryGiB: 42, memorySizeInGiB: 42 };
      delete partial[half];
      ctx.window[`${prefix}_SPECS`] = { compute: { [type]: partial } };
      const { result: halfResult, lines: halfLines } = capturingConsoleError(
        () => selector._mergeSpecs({ [type]: { [priceField]: 1.5 } }, "r1"),
      );
      check(
        `${name}: a priced record whose specs lost ${half} is excluded, by name`,
        !(type in halfResult) && halfLines.some((l) => l.includes(type)),
        JSON.stringify({ halfResult, halfLines }),
      );
    }

    // No specs blob at all is the pre-split manifest, and a monolith dropped in place
    // of one. Both must pass through untouched, or every page breaks the moment the
    // blob is missing rather than degrading to the format that is actually there.
    delete ctx.window[`${prefix}_SPECS`];
    const passthrough = selector._mergeSpecs(
      { [type]: { [priceField]: 1.5, [specField]: 2 } },
      "r1",
    );
    check(
      `${name}: with no specs blob the data passes through unchanged`,
      passthrough[type][priceField] === 1.5 &&
        passthrough[type][specField] === 2,
      JSON.stringify(passthrough),
    );
    if (saved === undefined) delete ctx.window[`${prefix}_SPECS`];
    else ctx.window[`${prefix}_SPECS`] = saved;
  }

  // The fallback is synthetic and already fat, with no entry in any specs blob to
  // find. loadRegionData must therefore NOT route it through the merge — doing so
  // would trip the guard on every one of its types and take the page down on the
  // exact path that exists to keep it up.
  {
    const src = fs.readFileSync(
      path.join(REPO, "js", "base", "base-instance-selector.js"),
      "utf8",
    );
    check(
      "loadRegionData exempts the fallback data from the merge",
      /usedFallback \? regionData : this\._mergeSpecs\(/.test(src),
      "the merge is not guarded by usedFallback",
    );
    // Structural, and scoped: the merge must sit at the join in loadRegionData, not
    // in _injectRegionScript. The goldens preload region files straight into the
    // context and never touch the injector, so a merge there would leave every
    // golden running on spec-less records — the one path that looks inert.
    const injector = (src.match(
      /async _injectRegionScript\([\s\S]*?\n {2}\}/,
    ) || [""])[0];
    check(
      "_injectRegionScript was found to inspect",
      injector.length > 100,
      `${injector.length} chars`,
    );
    check(
      "and the merge is NOT inside it",
      !injector.includes("_mergeSpecs"),
      "the injector merges, so the already-present-global route is missed",
    );
  }

  console.log("[requested srcs] " + requestedSrcs.join(", "));
  console.log("[freshness] AWS_DATA_DATE=" + ctx.AWS_DATA_DATE);
  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
