// End-of-life OS advisory (step 10): classifyEolOs recognises an OS past vendor
// end-of-life and suggests a modern landing OS, and analyzeInputHygiene surfaces
// it as an advisory (never an error, never a gate). The value of this check is
// entirely in its precision — a false "you are on EOL" is worse than a missed
// one — so the bulk of this suite is negative cases: current and unknown OS
// strings that must stay silent, and the CentOS-Stream / Amazon-Linux-2023 traps
// the regexes are written to avoid.
const { buildContext, makeChecker, parse } = require("../harness");

const { check, state } = makeChecker();
const panel = (elements) => elements.inputHygieneSection;

const { ctx } = buildContext();
const eol = (s) => ctx.classifyEolOs(s);

console.log(
  "[classifyEolOs flags real end-of-life strings, with a landing OS]",
);
{
  const flagged = [
    ["Windows Server 2012 R2", "Windows Server 2022"],
    ["Microsoft Windows Server 2008 R2 Standard", "Windows Server 2022"],
    ["Windows 7 Enterprise", "Windows 11"],
    ["CentOS Linux 7 (Core)", "Rocky Linux 9 or RHEL 9"],
    ["CentOS release 6.10 (Final)", "Rocky Linux 9 or RHEL 9"],
    ["Red Hat Enterprise Linux Server release 7.9", "RHEL 9"],
    ["RHEL 6", "RHEL 9"],
    ["Oracle Linux Server 7.9", "Oracle Linux 9"],
    ["Ubuntu 16.04.7 LTS", "Ubuntu 22.04 LTS or newer"],
    ["Ubuntu 18.04 LTS", "Ubuntu 22.04 LTS or newer"],
    ["Debian GNU/Linux 9 (stretch)", "Debian 12"],
    ["SUSE Linux Enterprise Server 12 SP5", "SLES 15"],
    ["SLES 11", "SLES 15"],
    ["Amazon Linux AMI 2018.03", "Amazon Linux 2023"],
    ["Amazon Linux 2", "Amazon Linux 2023"],
  ];
  flagged.forEach(([os, want]) => {
    check(`"${os}" → ${want}`, eol(os) === want, JSON.stringify(eol(os)));
  });
}

console.log("[classifyEolOs stays silent on current, unknown, or blank OS]");
{
  const silent = [
    // Current, still-supported releases — the ones the traps protect.
    "Windows Server 2022",
    "Windows Server 2019",
    "Windows Server 2016",
    "Windows 11 Pro",
    "CentOS Stream 9", // a current product, not EOL CentOS
    "Red Hat Enterprise Linux 9.3",
    "RHEL 8",
    "Oracle Linux Server 9.2",
    "Ubuntu 22.04.3 LTS",
    "Ubuntu 20.04 LTS", // deliberately omitted from the table (kept conservative)
    "Debian GNU/Linux 12 (bookworm)",
    "SUSE Linux Enterprise Server 15 SP5",
    "Amazon Linux 2023", // the 2 is followed by 0 — must not read as "Amazon Linux 2"
    // Generic / unknown strings a real inventory carries.
    "Linux",
    "Other Linux (64-bit)",
    "",
    "   ",
  ];
  silent.forEach((os) => {
    check(`"${os}" stays silent`, eol(os) === null, JSON.stringify(eol(os)));
  });
  check("null/undefined never throw", eol(null) === null && eol() === null);
}

console.log(
  "[the advisory is surfaced per distinct OS, with the carrying rows]",
);
{
  const { ctx: c2, elements } = buildContext();
  parse(
    c2,
    `VM Name,CPU Count,Memory (GB),AWS Region,OS
legacy-a,4,16,us-east-1,Windows Server 2012 R2
legacy-b,8,32,us-east-1,Windows Server 2012 R2
modern-c,4,16,us-east-1,Windows Server 2022`,
  );
  // csvData is a vm-scoped `let`, not readable as ctx.csvData; the pipeline
  // stores the computed report on window._inputHygiene after it runs.
  const report = c2.window._inputHygiene;
  const adv = report.issues.filter((i) => i.severity === "advisory");
  check(
    "one advisory for the one distinct EOL value",
    adv.length === 1,
    JSON.stringify(adv),
  );
  check(
    "it names the OS and the suggested landing OS",
    /Windows Server 2012 R2/.test(adv[0].label) &&
      /consider Windows Server 2022/.test(adv[0].label),
    adv[0] && adv[0].label,
  );
  check(
    "it says standard EOL and asks the reader to verify extended support",
    /past standard end-of-life/.test(adv[0].label) &&
      /ESU/.test(adv[0].label) &&
      /ESM/.test(adv[0].label),
    adv[0] && adv[0].label,
  );
  check(
    "it carries the two EOL rows (2 and 3), not the current-OS row",
    adv[0].rowNumbers.join(",") === "2,3",
    JSON.stringify(adv[0].rowNumbers),
  );
  check(
    "the panel renders it with the advisory icon, not the error icon",
    panel(elements).innerHTML.includes("🗓️") &&
      /past standard end-of-life/.test(panel(elements).innerHTML),
    panel(elements).innerHTML,
  );
}

console.log("[an advisory alone is informational — never an error tone]");
{
  const { ctx: c3, elements } = buildContext();
  parse(
    c3,
    `VM Name,CPU Count,Memory (GB),AWS Region,OS
only-eol,4,16,us-east-1,CentOS Linux 7 (Core)`,
  );
  check(
    "the panel is shown but styled info, not warning (no error present)",
    !panel(elements).classes.has("hidden") &&
      panel(elements).className.includes("alert-info") &&
      !panel(elements).className.includes("alert-warning"),
    `${panel(elements).className} | hidden=${panel(elements).classes.has("hidden")}`,
  );
  check(
    "no ❌ error marker appears for an advisory-only file",
    !panel(elements).innerHTML.includes("❌"),
    panel(elements).innerHTML,
  );
}

console.log("[a file with no OS column says nothing about EOL]");
{
  const { ctx: c4 } = buildContext();
  parse(
    c4,
    `VM Name,CPU Count,Memory (GB),AWS Region
no-os,4,16,us-east-1`,
  );
  const report = c4.window._inputHygiene;
  check(
    "no advisory without an OS column",
    report.issues.filter((i) => i.severity === "advisory").length === 0,
    JSON.stringify(report.issues),
  );
}

// process.exitCode, not process.exit(): exit() can truncate buffered stdout on a
// pipe (the CI case), dropping the FAIL: lines the run just wrote.
process.exitCode = state.failures ? 1 : 0;
