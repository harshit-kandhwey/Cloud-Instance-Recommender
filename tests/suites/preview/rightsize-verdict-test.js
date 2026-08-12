// Right-sizing verdict: the ▼ Downsized / ▲ Upsized flag that trails an OPTIMIZED
// instance name, comparing the utilization-based pick to the size the VM runs on
// today (its provisioned CPU Count / Memory (GB)). Display-only, like the fit
// flag — it must never reach a download. Silent on "same size", and shown only on
// the Optimized cell (never the like-for-like one, whose job is the fit flag).
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

// A row with an optimized recommendation: provisioned (cpu/mem) and the optimized
// pick it landed on (oCpu/oMem).
const opt = (name, { cpu, mem, oCpu, oMem, inst = "m5.large", p = "AWS" }) => ({
  "VM Name": name,
  "CPU Count": String(cpu),
  "Memory (GB)": String(mem),
  [`${p} Optimized Instance`]: inst,
  [`${p} Optimized vCPUs`]: oCpu,
  [`${p} Optimized Memory (GiB)`]: oMem,
});

const { ctx, elements } = buildContext();
const render = (rows) => {
  ctx.showResultsPreview(rows);
  return elements.resultsPreviewSection.innerHTML;
};
const rowFor = (html, vmName) =>
  (html.match(/<tr[\s\S]*?<\/tr>/g) || []).find((r) =>
    r.includes(`>${vmName}<`),
  ) || "";

console.log("[a smaller optimized pick reads Downsized; a larger one Upsized]");
{
  const html = render([
    opt("down", { cpu: 8, mem: 32, oCpu: 4, oMem: 16 }), // vCPU 8→4
    opt("up", { cpu: 2, mem: 8, oCpu: 4, oMem: 16 }), // vCPU 2→4
    opt("same", { cpu: 4, mem: 16, oCpu: 4, oMem: 16 }), // no change
  ]);
  check(
    "the shrunk row is flagged Downsized",
    rowFor(html, "down").includes("▼ Downsized"),
    rowFor(html, "down"),
  );
  check(
    "the grown row is flagged Upsized",
    rowFor(html, "up").includes("▲ Upsized"),
    rowFor(html, "up"),
  );
  // Assert the row was found before asserting what it lacks, or "no badge" passes
  // vacuously.
  const sameRow = rowFor(html, "same");
  check(
    "the same-size row is present to be checked",
    sameRow.includes(">same<"),
  );
  check(
    "an unchanged size carries no verdict badge",
    sameRow.includes(">same<") &&
      !sameRow.includes("Downsized") &&
      !sameRow.includes("Upsized"),
    sameRow,
  );
}

console.log("[memory breaks a vCPU tie, but only past the 10% tolerance]");
{
  const html = render([
    opt("memdown", { cpu: 4, mem: 32, oCpu: 4, oMem: 16 }), // vCPU tie, mem 32→16
    opt("gib", { cpu: 4, mem: 16, oCpu: 4, oMem: 15 }), // 15 GiB vs 16 GB → same
  ]);
  check(
    "a real memory shrink on a vCPU tie reads Downsized",
    rowFor(html, "memdown").includes("▼ Downsized"),
    rowFor(html, "memdown"),
  );
  check(
    "a GiB-vs-GB rounding gap stays within tolerance — no badge",
    !rowFor(html, "gib").includes("Downsized") &&
      !rowFor(html, "gib").includes("Upsized"),
    rowFor(html, "gib"),
  );
}

console.log(
  "[the verdict is drawn only on the optimized cell, never like-for-like]",
);
{
  // A like-for-like-only row, sized well above the requirement: the fit flag's
  // territory, not the verdict's. No Downsized/Upsized text must appear.
  const html = render([
    {
      "VM Name": "l2l",
      "CPU Count": "8",
      "Memory (GB)": "32",
      "AWS Like-to-Like Instance": "m5.large",
      "AWS Like-to-Like vCPUs": 2,
      "AWS Like-to-Like Memory (GiB)": 8,
    },
  ]);
  check(
    "a like-for-like cell never carries the verdict",
    !/Downsized|Upsized/.test(html),
    html,
  );
}

console.log("[a no-match optimized cell carries no verdict]");
{
  const html = render([
    {
      "VM Name": "nm",
      "CPU Count": "8",
      "Memory (GB)": "32",
      "AWS Optimized Instance": "No Match",
      "AWS Optimized vCPUs": "N/A",
      "AWS Optimized Memory (GiB)": "N/A",
    },
  ]);
  check(
    "a no-match row has no size to compare, so no badge",
    !/Downsized|Upsized/.test(html),
    html,
  );
}

console.log("[Downsized wears the good colour, Upsized the amber one]");
{
  const html = render([
    opt("down", { cpu: 8, mem: 32, oCpu: 4, oMem: 16 }),
    opt("up", { cpu: 2, mem: 8, oCpu: 4, oMem: 16 }),
  ]);
  const spanOf = (word) =>
    html.match(new RegExp(`<span[^>]*>[▼▲] ${word}</span>`))?.[0] || "";
  check(
    "Downsized is the good/positive colour (a saving)",
    spanOf("Downsized").includes("var(--good-strong)"),
    spanOf("Downsized"),
  );
  check(
    "Upsized is the amber colour (more resource)",
    spanOf("Upsized").includes("var(--amber-strong)"),
    spanOf("Upsized"),
  );
}

console.log("[the verdict is display-only — it never enters the row data]");
{
  const row = opt("a", { cpu: 8, mem: 32, oCpu: 4, oMem: 16 });
  const before = JSON.stringify(row);
  const keysBefore = Object.keys(row).length;
  render([row]);
  check("rendering does not mutate the row", JSON.stringify(row) === before);
  check("no column was added", Object.keys(row).length === keysBefore);
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
// pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;
