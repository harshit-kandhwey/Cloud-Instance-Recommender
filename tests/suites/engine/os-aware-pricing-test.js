// OS-aware pricing (base-instance-selector.js + the three provider mappings).
//
// A price is a property of a machine AND an operating system, not of a machine.
// The selector used to treat it as the latter: `mapping.price` named the LINUX
// field on all three providers and `parseData` price-sorted on it once, so every
// Windows row was both FILTERED and RANKED on a price it would never pay. That
// single fact produced two visible defects — a machine sold only with Linux stayed
// in the running for Windows rows (443 records across AWS and Azure: the
// Inferentia, GPU and FPGA families), and a machine sold only with Windows was
// dropped at load for want of a Linux price (u-6tb1.metal has no published Linux
// rate in ANY region, so a 6 TiB machine was unrecommendable to anyone).
//
// This suite pins the fix at every level it has to hold: the field carried off the
// record, the validity rule, the per-row pool, and the four consumers that read
// that pool (the primary pick, the alternative columns, the nearest miss, and the
// no-match reason).
//
// Two traps have their own checks, because both fail SILENTLY:
//   - `undefined` vs 0. Every shipped record carries the Windows field, so 0 there
//     is the provider saying "no Windows on this machine". The synthetic sample
//     data has no such field at all, and collapsing the two would empty the
//     FALLBACK pool for every Windows row — the app would look fine on real data
//     and blank out the moment it fell back.
//   - Re-sorting, not merely filtering. `parseData` sorts on the Linux price ONCE,
//     and everything downstream reads `[0]` as "cheapest". Remapping the price
//     without re-sorting leaves the Windows pick ranked on the Linux price, i.e.
//     the original defect surviving inside its own fix.
//
// Rule-engine-free by design: RuleEngine is not loaded here, so these checks are
// about price and OS alone. The engine's ARM exclusion is exercised by the workload
// suites, and it stays — for GCP it is the only real "cannot run Windows" signal,
// because GCP's Windows price is COMPOSED by us (hourly + vCPUs x licensing) rather
// than published per type, and so is never 0.
const { buildEngineContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const { ctx, run } = buildEngineContext({
  scripts: ["js/base/base-instance-selector.js"],
  label: "os-aware-pricing",
});

// A bare concrete selector (base filters only) — no provider subclass, so nothing
// provider-specific can mask a base-layer regression.
run(`
  __sel = new BaseInstanceSelector();
  __sel.getProviderName = function () { return "AWS"; };
  __sel.getSampleData = function () { return []; };
`);

const base = {
  generation: 2,
  familyName: "General purpose",
  processor: "Intel",
  isGraviton: 0,
};

// Ordered by LINUX price, which is the order parseData leaves behind.
ctx.poolMain = [
  // Inferentia: real hardware, sold with Linux only. The cheapest thing here on
  // Linux, and must be unreachable on Windows.
  {
    ...base,
    instanceType: "inf1.xlarge",
    family: "inf1",
    vCpus: 4,
    memory: 8,
    price: 0.02,
    windowsPrice: 0,
  },
  {
    ...base,
    instanceType: "t3.medium",
    family: "t3",
    vCpus: 2,
    memory: 4,
    price: 0.04,
    windowsPrice: 0.1,
  },
  {
    ...base,
    instanceType: "m5.large",
    family: "m5",
    vCpus: 2,
    memory: 8,
    price: 0.1,
    windowsPrice: 0.2,
  },
  // The mirror image: no Linux price anywhere, Windows priced everywhere.
  {
    ...base,
    instanceType: "u-6tb1.metal",
    family: "u-6tb1",
    vCpus: 8,
    memory: 64,
    price: 0,
    windowsPrice: 0.5,
  },
];

// Both are sold with both OSes, so nothing is excluded — the ONLY thing that can
// change the pick is the ranking. Windows licensing is charged per vCPU, so the
// big cheap-on-Linux machine is the expensive one on Windows.
ctx.poolFlip = [
  {
    ...base,
    instanceType: "big.8x",
    family: "big",
    vCpus: 8,
    memory: 16,
    price: 0.05,
    windowsPrice: 0.6,
  },
  {
    ...base,
    instanceType: "small.2x",
    family: "small",
    vCpus: 2,
    memory: 4,
    price: 0.09,
    windowsPrice: 0.15,
  },
];

// Sample/fallback shape: no windowsPrice KEY at all.
ctx.poolSample = [
  {
    ...base,
    instanceType: "s1.small",
    family: "s1",
    vCpus: 2,
    memory: 4,
    price: 0.03,
  },
  {
    ...base,
    instanceType: "s2.large",
    family: "s2",
    vCpus: 4,
    memory: 8,
    price: 0.07,
  },
];

const types = (list) => (list || []).map((i) => i.instanceType);

// ── the field comes off the record without collapsing undefined into 0 ────────
{
  const mapping = {
    instanceType: "instanceType",
    vCpus: "vCpus",
    memory: "memory",
    price: "lin",
    priceWindows: "win",
  };
  ctx.mapping = mapping;

  ctx.recAbsent = { vCpus: 2, memory: 4, lin: 0.04 };
  ctx.recZero = { vCpus: 2, memory: 4, lin: 0.04, win: 0 };
  ctx.recPriced = { vCpus: 2, memory: 4, lin: 0.04, win: 0.11 };

  const absent = run(
    `__sel.createStandardizedInstance("t3.medium", recAbsent, "r1", mapping)`,
  );
  const zero = run(
    `__sel.createStandardizedInstance("t3.medium", recZero, "r1", mapping)`,
  );
  const priced = run(
    `__sel.createStandardizedInstance("t3.medium", recPriced, "r1", mapping)`,
  );

  check(
    "a record with no Windows field reads as undefined, not 0",
    absent.windowsPrice === undefined,
    `got ${JSON.stringify(absent.windowsPrice)}`,
  );
  check(
    "a record whose Windows price IS 0 keeps the 0 (the provider's own statement)",
    zero.windowsPrice === 0,
    `got ${JSON.stringify(zero.windowsPrice)}`,
  );
  check(
    "a priced Windows field is carried through as a number",
    priced.windowsPrice === 0.11,
    `got ${JSON.stringify(priced.windowsPrice)}`,
  );
}

// ── validity: priced for at least ONE operating system ────────────────────────
{
  const valid = (o) => run(`__sel.isValidInstance(${JSON.stringify(o)})`);
  check(
    "a Windows-only machine is valid (this is what dropped u-6tb1.metal)",
    valid({
      instanceType: "u-6tb1.metal",
      vCpus: 8,
      memory: 64,
      price: 0,
      windowsPrice: 0.5,
    }) === true,
  );
  check(
    "a Linux-only machine is still valid",
    valid({
      instanceType: "inf1.xlarge",
      vCpus: 4,
      memory: 8,
      price: 0.02,
      windowsPrice: 0,
    }) === true,
  );
  check(
    "priced for neither OS is invalid",
    valid({
      instanceType: "ghost.large",
      vCpus: 4,
      memory: 8,
      price: 0,
      windowsPrice: 0,
    }) === false,
  );
  check(
    "an unpriced machine with no Windows field at all is invalid",
    valid({ instanceType: "ghost.large", vCpus: 4, memory: 8, price: 0 }) ===
      false,
  );
}

// ── _poolForOS: the Linux branch is today's behaviour, unchanged ──────────────
{
  const lin = run(`__sel._poolForOS(poolMain, "Linux")`);
  check(
    "Linux keeps every Linux-priced machine and drops the Windows-only one",
    JSON.stringify(types(lin)) ===
      JSON.stringify(["inf1.xlarge", "t3.medium", "m5.large"]),
    JSON.stringify(types(lin)),
  );
  check(
    "Linux does not remap the price",
    lin[0].price === 0.02 && lin[2].price === 0.1,
    JSON.stringify(lin.map((i) => i.price)),
  );
  const blank = run(`__sel._poolForOS(poolMain, "")`);
  check(
    "a missing OS is treated as Linux, not as Windows",
    JSON.stringify(types(blank)) === JSON.stringify(types(lin)),
    JSON.stringify(types(blank)),
  );
}

// ── _poolForOS: the Windows branch excludes, remaps AND re-sorts ──────────────
{
  const win = run(`__sel._poolForOS(poolMain, "Windows Server 2022")`);
  check(
    "Windows drops the machine with no Windows price",
    !types(win).includes("inf1.xlarge"),
    JSON.stringify(types(win)),
  );
  check(
    "Windows keeps the machine that has no Linux price",
    types(win).includes("u-6tb1.metal"),
    JSON.stringify(types(win)),
  );
  check(
    "Windows remaps price to the price the row would actually pay",
    win.every((i) => i.price === i.windowsPrice),
    JSON.stringify(win.map((i) => [i.instanceType, i.price])),
  );
  check(
    "the Windows pool is re-sorted on the Windows price",
    JSON.stringify(types(win)) ===
      JSON.stringify(["t3.medium", "m5.large", "u-6tb1.metal"]),
    JSON.stringify(types(win)),
  );

  // The flip pool has nothing to exclude, so a stale Linux ordering would survive
  // here invisibly: both machines are present either way, only [0] differs.
  const flip = run(`__sel._poolForOS(poolFlip, "Windows")`);
  check(
    "re-sorting, not just filtering: the cheapest on Linux is not the cheapest on Windows",
    types(flip)[0] === "small.2x",
    JSON.stringify(types(flip)),
  );

  // instanceData is cached and reused for every row of the run, so a pool that
  // sorted or rewrote its input in place would poison the next row.
  check(
    "the caller's pool is left untouched (it is shared across every row)",
    JSON.stringify(types(ctx.poolMain)) ===
      JSON.stringify([
        "inf1.xlarge",
        "t3.medium",
        "m5.large",
        "u-6tb1.metal",
      ]) && ctx.poolMain[1].price === 0.04,
    JSON.stringify(types(ctx.poolMain)),
  );
}

// ── _poolForOS: unknown (sample data) must not read as unavailable ────────────
{
  const win = run(`__sel._poolForOS(poolSample, "Windows")`);
  check(
    "a pool with no Windows field survives a Windows row (the fallback trap)",
    JSON.stringify(types(win)) === JSON.stringify(["s1.small", "s2.large"]),
    JSON.stringify(types(win)),
  );
  check(
    "and those records keep their own price rather than being zeroed",
    win.length === 2 && win[0].price === 0.03 && win[1].price === 0.07,
    JSON.stringify(win.map((i) => i.price)),
  );
}

// ── end to end: the pick changes with the OS ──────────────────────────────────
run(`__sel.instanceData = { r1: poolMain, r2: poolFlip };`);
{
  const linux = run(`__sel.getLikeToLikeInstance("r1", 2, 4, {})`);
  check(
    "a Linux row still picks the cheapest Linux machine",
    linux.instanceType === "inf1.xlarge",
    linux.instanceType,
  );

  const win = run(
    `__sel.getLikeToLikeInstance("r1", 2, 4, { rowOS: "Windows Server 2022" })`,
  );
  check(
    "a Windows row is never offered a machine that sells no Windows",
    win.instanceType !== "inf1.xlarge",
    win.instanceType,
  );
  check(
    "a Windows row picks the cheapest machine that DOES sell Windows",
    win.instanceType === "t3.medium",
    win.instanceType,
  );

  const flipLin = run(`__sel.getLikeToLikeInstance("r2", 2, 4, {})`);
  const flipWin = run(
    `__sel.getLikeToLikeInstance("r2", 2, 4, { rowOS: "Windows Server 2019" })`,
  );
  check(
    "with nothing excluded, the OS alone re-ranks the pick (Linux)",
    flipLin.instanceType === "big.8x",
    flipLin.instanceType,
  );
  check(
    "with nothing excluded, the OS alone re-ranks the pick (Windows)",
    flipWin.instanceType === "small.2x",
    flipWin.instanceType,
  );
}

// ── end to end: a Windows-only machine becomes reachable, and stays Linux-proof ─
{
  // Only u-6tb1.metal meets 8 vCPU / 64 GB, and it has no Linux price.
  const linux = run(`__sel.getLikeToLikeInstance("r1", 8, 64, {})`);
  check(
    "a Linux row cannot reach a machine that sells no Linux",
    linux.instanceType === "No data available",
    linux.instanceType,
  );
  const win = run(
    `__sel.getLikeToLikeInstance("r1", 8, 64, { rowOS: "Windows Server 2022" })`,
  );
  check(
    "a Windows row CAN reach it (the 6 TiB machine nobody could be recommended)",
    win.instanceType === "u-6tb1.metal",
    win.instanceType,
  );
}

// ── the alternative columns read the same OS-priced pool ──────────────────────
{
  const win = run(
    `__sel.getLikeToLikeInstance("r1", 2, 4, { rowOS: "Windows Server 2022" })`,
  );
  check(
    "Most Cost Optimized cannot name a machine this OS is not sold on",
    win.alternatives &&
      win.alternatives.cost &&
      win.alternatives.cost.instanceType !== "inf1.xlarge",
    JSON.stringify(win.alternatives && win.alternatives.cost),
  );
  check(
    "Most Cost Optimized is the cheapest at the price this row would pay",
    win.alternatives.cost.instanceType === "t3.medium",
    JSON.stringify(win.alternatives.cost),
  );
  const lin = run(`__sel.getLikeToLikeInstance("r1", 2, 4, {})`);
  check(
    "and on Linux the same column still names the cheapest Linux machine",
    lin.alternatives.cost.instanceType === "inf1.xlarge",
    JSON.stringify(lin.alternatives.cost),
  );
}

// ── the nearest miss is advice, so it must name something deployable ──────────
{
  // Every machine here is Intel, so demanding AMD empties the pool and the row
  // falls to the nearest-miss path.
  const opts = `{ restrictProcessorManufacturers: true, selectedProcessorManufacturers: ["AMD"] }`;
  const lin = run(`__sel.getLikeToLikeInstance("r1", 2, 4, ${opts})`);
  check(
    "the Linux nearest miss is the cheapest size-fitting Linux machine",
    lin.nearestMiss && lin.nearestMiss.instanceType === "inf1.xlarge",
    JSON.stringify(lin.nearestMiss),
  );
  const win = run(
    `__sel.getLikeToLikeInstance("r1", 2, 4, { ...${opts}, rowOS: "Windows Server 2022" })`,
  );
  check(
    "the Windows nearest miss never points at a machine no filter change could unlock",
    win.nearestMiss && win.nearestMiss.instanceType !== "inf1.xlarge",
    JSON.stringify(win.nearestMiss),
  );
  check(
    "it names the cheapest size-fitting machine that DOES sell Windows",
    win.nearestMiss && win.nearestMiss.instanceType === "t3.medium",
    JSON.stringify(win.nearestMiss),
  );
}

// ── an OS with nothing on offer says so, rather than reporting no data ────────
{
  ctx.poolLinuxOnly = [
    {
      ...base,
      instanceType: "inf1.xlarge",
      family: "inf1",
      vCpus: 4,
      memory: 8,
      price: 0.02,
      windowsPrice: 0,
    },
  ];
  run(`__sel.instanceData = { ...__sel.instanceData, r3: poolLinuxOnly };`);
  const win = run(
    `__sel.getLikeToLikeInstance("r3", 2, 4, { rowOS: "Windows Server 2022" })`,
  );
  check(
    "an empty OS pool is reported as an OS problem, not a missing-region one",
    /Windows/.test(String(win.reason || "")) &&
      !/not found/.test(String(win.reason || "")),
    JSON.stringify(win.reason),
  );
}

// ── every provider maps the Windows price to its own real field ───────────────
{
  const { ctx: pctx, run: prun } = buildEngineContext({
    scripts: [
      "js/base/base-instance-selector.js",
      "js/aws/aws-instance-selector.js",
      "js/azure/azure-instance-selector.js",
      "js/gcp/gcp-instance-selector.js",
    ],
    label: "os-aware-pricing-mappings",
  });
  void pctx;
  const EXPECTED = {
    AWSInstanceSelector: ["onDemandLinuxHr", "onDemandWindowsHr"],
    AzureInstanceSelector: ["linuxPrice", "windowsPrice"],
    GCPInstanceSelector: ["hourlyPrice", "windowsHourlyPrice"],
  };
  for (const [cls, [lin, win]] of Object.entries(EXPECTED)) {
    const m = prun(`new ${cls}().getFieldMappings()`);
    check(
      `${cls} maps the Windows price to ${win}`,
      m.priceWindows === win,
      `got ${JSON.stringify(m.priceWindows)}`,
    );
    check(
      `${cls} still maps the plain price to the LINUX field ${lin}`,
      m.price === lin,
      `got ${JSON.stringify(m.price)}`,
    );
    check(
      `${cls} keeps the two prices distinct`,
      m.price !== m.priceWindows,
      `${m.price} vs ${m.priceWindows}`,
    );
  }
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout when
// it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
if (state.failures) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("os-aware-pricing-test: all checks passed");
}
