// Fit / headroom: how much spare capacity a like-for-like recommendation leaves
// over the requested size, and the ▲% flag that trails an over-provisioned match
// in the preview. Two layers: the pure primitive computeFitHeadroom, and the
// display badge — which is display-only, so it must never reach a download.
const { buildContext, makeChecker } = require("./harness");

const { check, state } = makeChecker();

// A like-for-like row: requirement (cpu/mem) and the instance it landed on
// (iCpu/iMem). Defaults land on a real-looking AWS name.
const l2l = (
  name,
  { cpu, mem, iCpu, iMem, inst = "m5.xlarge", p = "AWS" },
) => ({
  "VM Name": name,
  "CPU Count": String(cpu),
  "Memory (GB)": String(mem),
  [`${p} Like-to-Like Instance`]: inst,
  [`${p} Like-to-Like vCPUs`]: iCpu,
  [`${p} Like-to-Like Memory (GiB)`]: iMem,
});

const { ctx, elements } = buildContext();
const headroom = ctx.computeFitHeadroom;

// One VM's own <tr>, so a per-row assertion is scoped to that row and nothing
// else. This used to be `html.split("mild")[0]`, which assumed "mild" appeared
// exactly once and only after the row under test — it would have silently
// mis-scoped the moment the row order or the surrounding markup changed, and a
// check that quietly stops covering its row is worse than no check.
const rowFor = (html, vmName) =>
  (html.match(/<tr[\s\S]*?<\/tr>/g) || []).find((r) =>
    r.includes(`>${vmName}<`),
  ) || "";

console.log("[computeFitHeadroom reads the excess over the requested size]");
{
  // Requirement 2/8 landed on 4/16: double on both axes → 100% on each, worst
  // is 100% and the binding-axis tie resolves to vCPU.
  const h = headroom(l2l("a", { cpu: 2, mem: 8, iCpu: 4, iMem: 16 }), "AWS");
  check("headroom is computed", h !== null, JSON.stringify(h));
  check("vCPU headroom is 100%", Math.round(h.cpu * 100) === 100, `${h.cpu}`);
  check("memory headroom is 100%", Math.round(h.mem * 100) === 100, `${h.mem}`);
  check("the worst axis is reported", Math.round(h.worst * 100) === 100);
  // The tie-break itself, not just the magnitude: with both axes at 100% the
  // worst is the same number either way, so a regression that resolved the tie
  // to "memory" would leave every assertion above green while the flag named
  // the wrong axis.
  check("a tie resolves to vCPU", h.axis === "vCPU", h.axis);
}

console.log("[the worst axis is the one that is most over-provisioned]");
{
  // 14 vCPU / 8 GB landed on 16/32: vCPU +14%, memory +300%. Memory is the
  // waste, so that is the axis the flag names.
  const h = headroom(l2l("a", { cpu: 14, mem: 8, iCpu: 16, iMem: 32 }), "AWS");
  check("memory is the worst axis", h.axis === "memory", h.axis);
  check(
    "worst headroom is 300%",
    Math.round(h.worst * 100) === 300,
    `${h.worst}`,
  );
}

console.log("[a perfect fit has zero headroom]");
{
  const h = headroom(l2l("a", { cpu: 4, mem: 16, iCpu: 4, iMem: 16 }), "AWS");
  check("worst headroom is 0", h.worst === 0, `${h.worst}`);
}

console.log("[headroom is null when there is nothing to compare]");
{
  // A no-match row has no instance vCPUs/Memory to read.
  const noMatch = headroom(
    {
      "VM Name": "x",
      "CPU Count": "4",
      "Memory (GB)": "16",
      "AWS Like-to-Like vCPUs": "N/A",
      "AWS Like-to-Like Memory (GiB)": "N/A",
    },
    "AWS",
  );
  check("null when the instance size is not a number", noMatch === null);
  // A zero requirement would divide by zero.
  const zero = headroom(
    l2l("a", { cpu: 0, mem: 16, iCpu: 4, iMem: 16 }),
    "AWS",
  );
  check("null when the requirement is zero", zero === null);
}

console.log("[the ▲ flag trails an over-provisioned like-for-like match]");
{
  ctx.showResultsPreview([
    l2l("tight", { cpu: 4, mem: 16, iCpu: 4, iMem: 16 }), // 0% → no flag
    l2l("mild", { cpu: 3, mem: 10, iCpu: 4, iMem: 16 }), // 60% mem → flag
    l2l("heavy", { cpu: 14, mem: 8, iCpu: 16, iMem: 32, inst: "a1.4xlarge" }), // 300%
  ]);
  const html = elements.resultsPreviewSection.innerHTML;
  const badges = html.match(/▲\d+%/g) || [];

  check(
    "exactly the two over-provisioned rows are flagged",
    badges.length === 2,
    badges.join(","),
  );
  check(
    "the 60% mild case is shown",
    badges.includes("▲60%"),
    badges.join(","),
  );
  check(
    "the 300% heavy case is shown",
    badges.includes("▲300%"),
    badges.join(","),
  );
  // Assert the row was actually found before asserting what it lacks: a lookup
  // that returned nothing would make "no flag in this row" pass vacuously.
  const tightRow = rowFor(html, "tight");
  check(
    "the tight row is present to be checked",
    tightRow.includes(">tight<"),
    "row lookup found nothing — the next check would pass vacuously",
  );
  check(
    "the tight fit carries no flag",
    tightRow.includes(">tight<") && !tightRow.includes("▲"),
    tightRow,
  );
  check(
    "the flag carries a text alternative naming the axis and the numbers",
    /aria-label="Over-provisioned: provides [^"]*required — \d+% (?:vCPU|memory) headroom"/.test(
      html,
    ),
    html.match(/aria-label="Over-provisioned[^"]*"/)?.[0],
  );
}

console.log("[the strong tier is drawn more emphatically than the mild one]");
{
  ctx.showResultsPreview([
    l2l("mild", { cpu: 3, mem: 10, iCpu: 4, iMem: 16 }), // 60% → mild
    l2l("heavy", { cpu: 2, mem: 8, iCpu: 4, iMem: 16 }), // 100% → strong
  ]);
  const html = elements.resultsPreviewSection.innerHTML;
  // The strong badge (≥100%) is bold and wears the deeper amber; the mild one is
  // neither. Find each badge's own span and check its style.
  const spanOf = (pct) =>
    html.match(new RegExp(`<span[^>]*>▲${pct}%</span>`))?.[0] || "";
  check(
    "the mild flag is the standard amber, not bold",
    spanOf(60).includes("var(--amber-strong)") &&
      !spanOf(60).includes("font-weight:700"),
    spanOf(60),
  );
  check(
    "the strong flag is the deeper amber and bold",
    spanOf(100).includes("var(--amber-deep)") &&
      spanOf(100).includes("font-weight:700"),
    spanOf(100),
  );
}

console.log("[only the like-for-like recommendation is flagged]");
{
  // An optimized-only run: its rightsizing is shown by the vCPU diff, not by a
  // headroom flag (the optimized target is utilization-adjusted, not the
  // requested size), so no ▲ appears.
  ctx.showResultsPreview([
    {
      "VM Name": "a",
      "CPU Count": "8",
      "Memory (GB)": "32",
      "AWS Optimized Instance": "m5.large",
      "AWS Optimized vCPUs": 2,
      "AWS Optimized Memory (GiB)": 8,
    },
  ]);
  const html = elements.resultsPreviewSection.innerHTML;
  check(
    "an optimized-only run carries no headroom flag",
    !/▲\d+%/.test(html),
    html.match(/▲\d+%/)?.[0],
  );

  // The discriminating case: when BOTH kinds are present and both are over-
  // provisioned, the flag appears on the like-for-like cell ALONE — exactly one
  // ▲ per row. A flag logic that matched the optimized column too (or mis-derived
  // its provider) would double-flag the row.
  ctx.showResultsPreview([
    {
      "VM Name": "both",
      "CPU Count": "2",
      "Memory (GB)": "8",
      "AWS Like-to-Like Instance": "m5.xlarge",
      "AWS Like-to-Like vCPUs": 4,
      "AWS Like-to-Like Memory (GiB)": 16,
      "AWS Optimized Instance": "m5.xlarge",
      "AWS Optimized vCPUs": 4,
      "AWS Optimized Memory (GiB)": 16,
    },
  ]);
  const both = elements.resultsPreviewSection.innerHTML;
  check(
    "with both kinds present, exactly one ▲ is drawn — on the like-for-like cell",
    (both.match(/▲\d+%/g) || []).length === 1,
    (both.match(/▲\d+%/g) || []).join(","),
  );
}

console.log("[the flag is display-only — it never enters the row data]");
{
  // The badge lives in preview HTML alone; rendering must not add a key or mutate
  // a value, or it would leak into the CSV/Excel download and move the goldens.
  const row = l2l("a", { cpu: 2, mem: 8, iCpu: 4, iMem: 16 });
  const before = JSON.stringify(row);
  const keysBefore = Object.keys(row).length;
  ctx.showResultsPreview([row]);
  check(
    "the row is not mutated by rendering the flag",
    JSON.stringify(row) === before,
  );
  check(
    "no column was added to the row",
    Object.keys(row).length === keysBefore,
  );
}

process.exit(state.failures ? 1 : 0);
