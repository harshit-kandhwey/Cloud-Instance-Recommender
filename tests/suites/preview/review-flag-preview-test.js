// The Review Flag column (3.21 phase 7): a per-row policy run flags a VM whose
// downsize the safety veto held. The results table renders only columns named in the
// preview's allow-list, so a flag the run produced but the table dropped would hide
// exactly the rows the user was meant to look at.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const row = (name, flag) => ({
  "VM Name": name,
  "CPU Count": "8",
  "Memory (GB)": "32",
  ENV: "Dev",
  "Sized On": "Average · policy: dev + critical → p99, capped by dev to avg",
  ...(flag === undefined ? {} : { "Review Flag": flag }),
  "AWS Optimized Instance": "m5.xlarge",
  "AWS Optimized vCPUs": "4",
  "AWS Optimized Memory (GiB)": "16",
});

const FLAG = "CPU downsize held for review: Peak 97% reaches 95%";

console.log("[a policy run's Review Flag column renders in the table]");
{
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview([row("held-vm", FLAG), row("calm-vm", "")]);
  const cols = ctx._previewState.displayCols;
  const html = elements.resultsPreviewSection.innerHTML;
  check(
    "the column is displayed, right after Sized On",
    cols.indexOf("Review Flag") === cols.indexOf("Sized On") + 1,
    cols.join(","),
  );
  check(
    "a flagged row shows its reason",
    html.includes(FLAG),
    html.slice(0, 200),
  );
  check("the column has a header cell", html.includes(">Review Flag"));
}

console.log("[a run without the column does not invent one]");
{
  const { ctx } = buildContext();
  ctx.showResultsPreview([row("a"), row("b")]);
  check(
    "no Review Flag column when the results carry none",
    !ctx._previewState.displayCols.includes("Review Flag"),
    ctx._previewState.displayCols.join(","),
  );
}

console.log("[the flag text is escaped like any other cell]");
{
  const { ctx, elements } = buildContext();
  ctx.showResultsPreview([row("x", "<img src=x onerror=alert(1)>")]);
  const html = elements.resultsPreviewSection.innerHTML;
  check(
    "markup in a flag is shown as text, never inserted",
    !html.includes("<img src=x") && html.includes("&lt;img"),
  );
}

process.exitCode = state.failures ? 1 : 0;
