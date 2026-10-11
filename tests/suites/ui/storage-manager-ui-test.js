// The storage panel's markup builder (src/ui/storage-manager-ui.js, 3.21 phase 1).
// Covered here: byte formatting, one row per owned key with the right state and
// enabled control, escaping of any text that reaches the markup, and no inline
// handler attributes (CLAUDE rule 5). The two-step clear flow needs a live DOM and
// is covered by the e2e suite instead.
const { REPO, buildEngineContext, makeChecker } = require("../harness");

const ctx = buildEngineContext({
  scripts: [
    "src/shared/storage-keys.js",
    "src/shared/storage-manager.js",
    "src/shared/app-core.js",
  ],
  label: "storage-manager-ui",
});
ctx.ctx.document = {
  addEventListener() {},
  getElementById() {
    return null;
  },
};
ctx.load("src/features/fleet-snapshots.js");
ctx.load("src/ui/storage-manager-ui.js");

const { check, state } = makeChecker();
const { run } = ctx;

check(
  "formats bytes below one KB as bytes",
  run("formatStorageBytes(0)") === "0 B" &&
    run("formatStorageBytes(1023)") === "1023 B",
);
check(
  "formats KB and MB at their thresholds",
  run("formatStorageBytes(1024)") === "1.0 KB" &&
    run("formatStorageBytes(1048576)") === "1.00 MB",
);

const owned = Object.keys(run("STORAGE_KEYS"));
const usage = {
  items: owned.map((id, i) => ({
    id,
    key: run(`STORAGE_KEYS.${id}`),
    present: i === 0,
    bytes: i === 0 ? 2048 : 0,
  })),
  totalBytes: 2048,
};
const html = run("renderStorageRows")(usage);

check(
  "renders one table row per owned key",
  (html.match(/<tr>/g) || []).length === owned.length,
);
check(
  "a stored key shows as stored with an enabled Clear button",
  /stored<\/td>[\s\S]*?<td>2\.0 KB<\/td>[\s\S]*?data-storage-id="[^"]+">Clear</.test(
    html,
  ) && !/data-storage-id="[^"]+" disabled/.test(html.split("<tr>")[1]),
);
check(
  "an empty key shows as empty with a disabled Clear button",
  html.split("<tr>")[2].includes("empty") &&
    html.split("<tr>")[2].includes(" disabled>"),
);

const hostile = run("renderStorageRows")({
  items: [
    {
      id: '"><img src=x onerror=alert(1)>',
      key: "<img src=x onerror=alert(2)>",
      present: true,
      bytes: 0,
    },
  ],
  totalBytes: 0,
});
check(
  "escapes a hostile key and id before they reach the markup",
  !hostile.includes("<img") && hostile.includes("&lt;img"),
);
const attrNamesOnly = (s) => s.replace(/="[^"]*"/g, '=""');
const inTagHandler = /<[^>]*\son[a-z]+\s*=/i;
check(
  "emits no inline event handler attributes on any tag",
  !inTagHandler.test(attrNamesOnly(html)) &&
    !inTagHandler.test(attrNamesOnly(hostile)),
);

const snapshotHtml = run("renderFleetSnapshotRows")([
  {
    id: 'a"><img src=x onerror=alert(3)>',
    name: "<img src=x onerror=alert(4)>",
    takenAt: "2026-10-04T00:00:00Z",
    rows: [{ VM: "a" }, { VM: "b" }],
  },
]);
check(
  "a hostile snapshot name is escaped before it reaches the markup",
  !snapshotHtml.includes("<img") && snapshotHtml.includes("&lt;img"),
);
check(
  "a hostile snapshot id cannot break out of its attribute",
  !/data-snapshot-delete="[^"]*"><img/.test(snapshotHtml),
);
check("a snapshot row reports its VM count", snapshotHtml.includes("2 VMs"));
check(
  "snapshot rows emit no inline event handler attributes",
  !inTagHandler.test(attrNamesOnly(snapshotHtml)),
);

const sameMsg = run("fleetCompareMessage")({
  ok: true,
  overlap: 1,
  added: [],
  removed: [],
});
check(
  "a matching estate reports its overlap and changes",
  sameMsg === "Same estate (100% of VMs in common): 0 added, 0 removed.",
  sameMsg,
);
const diffMsg = run("fleetCompareMessage")({
  ok: false,
  reason: "low-overlap",
  overlap: 0.5,
  added: [],
  removed: ["vm-a", "vm-b"],
});
check(
  "a different estate names what went missing and suggests saving the run",
  diffMsg.includes("Removed: vm-a, vm-b.") &&
    diffMsg.includes("Save this run as a new snapshot to keep it."),
  diffMsg,
);
const longRemoved = Array.from({ length: 12 }, (_, i) => `vm-${i}`);
const longMsg = run("fleetCompareMessage")({
  ok: false,
  reason: "low-overlap",
  overlap: 0.2,
  added: [],
  removed: longRemoved,
});
check(
  "a long removed list is cut to ten names with a count of the rest",
  longMsg.includes("and 2 more.") && !longMsg.includes("vm-11"),
  longMsg,
);
check(
  "an unkeyed comparison asks for unique VM names",
  run("fleetCompareMessage")({ ok: false, reason: "not-keyed" }).includes(
    "unique, non-blank VM Name",
  ),
);

const diffFixture = {
  cols: ["Recommended Instance"],
  note: "",
  summary: { changedCells: 1 },
  changedRows: [
    {
      key: "<img src=x onerror=alert(5)>",
      cells: [
        {
          col: "Recommended Instance",
          a: "m5.large",
          b: "<b>r5</b>",
          changed: true,
        },
        { col: "ENV", a: "Prod", b: "Prod", changed: false },
      ],
    },
  ],
};
const diffHtml = run("renderSnapshotDiffHtml")(diffFixture);
check(
  "a diff escapes VM names and values before they reach the markup",
  !diffHtml.includes("<img") &&
    !diffHtml.includes("<b>") &&
    diffHtml.includes("&lt;b&gt;r5&lt;/b&gt;"),
);
check(
  "a diff shows only the changed cells",
  !diffHtml.includes("Prod") && diffHtml.includes("m5.large"),
);
check(
  "a diff summary counts changed VMs and cells",
  diffHtml.includes("1 VM changed, 1 cell across 1 compared column."),
  diffHtml.slice(0, 120),
);
check(
  "a diff with no change says so",
  run("renderSnapshotDiffHtml")({
    cols: ["X"],
    note: "",
    summary: { changedCells: 0 },
    changedRows: [],
  }).includes("No compared cell changed."),
);
const manyRows = Array.from({ length: 60 }, (_, i) => ({
  key: `vm-${i}`,
  cells: [{ col: "X", a: "1", b: "2", changed: true }],
}));
const capped = run("renderSnapshotDiffHtml")({
  cols: ["X"],
  note: "",
  summary: { changedCells: 60 },
  changedRows: manyRows,
});
check(
  "a long diff shows fifty rows and says how many changed",
  (capped.match(/<th scope="row">vm-/g) || []).length === 50 &&
    capped.includes("Showing the first 50 of 60 changed VMs."),
);

// ── Snapshot file controls ───────────────────────────────────────────────
{
  const rows = run("renderFleetSnapshotRows")([
    { id: 's"1', name: "<b>x</b>", takenAt: "2026-10-01", rows: [{}, {}] },
  ]);
  check(
    "each snapshot row offers an export control carrying its escaped id",
    rows.includes('data-snapshot-export="s&quot;1"'),
    rows,
  );
  check(
    "snapshot rows still carry no inline handler",
    !/\son[a-z]+\s*=/i.test(rows),
    rows,
  );
  const form = run("renderImportRenameHtml")(
    'a"><img src=x>',
    'a"><img src=y> (2)',
  );
  check(
    "the rename form escapes both the taken name and the suggestion",
    !form.includes("<img") && form.includes("&lt;img"),
    form,
  );
  check(
    "every refusal reason an import can return has a message",
    [
      "too-large",
      "not-json",
      "not-snapshot",
      "version",
      "no-rows",
      "too-many-rows",
      "bad-row",
      "bad-providers",
      "bad-rules",
      "bad-date",
      "empty",
      "too-long",
      "quota",
      "changed",
    ].every((r) => typeof run("IMPORT_REFUSALS")[r] === "string"),
  );
}

// A file refused only for its name leaves its text for the rename form. Choosing another
// file must not leave that text behind, whether the new file is read or not.
{
  const pick = (file) =>
    run("handleFleetSnapshotImportFile")({
      target: { matches: () => true, files: [file] },
    });
  const pending = () => run("fleetPendingImportText");

  run('fleetPendingImportText = "earlier refused file"');
  pick({ size: run("FleetSnapshots.MAX_IMPORT_CHARS") + 1 });
  check(
    "choosing a file that is too large clears the earlier pending text",
    pending() === null,
    String(pending()),
  );

  run('fleetPendingImportText = "earlier refused file"');
  const realReader = ctx.ctx.FileReader;
  ctx.ctx.FileReader = class {
    readAsText() {
      this.onerror();
    }
  };
  pick({ size: 10 });
  ctx.ctx.FileReader = realReader;
  check(
    "choosing a file that cannot be read clears the earlier pending text",
    pending() === null,
    String(pending()),
  );
}

// What the panel shows once an import finishes, with the panel present.
{
  const host = { innerHTML: "" };
  const realGet = ctx.ctx.document.getElementById;
  ctx.ctx.document.getElementById = (id) =>
    id === "fleetSnapshotsPanel" ? host : null;
  const finish = (result) => {
    host.innerHTML = "";
    run("finishFleetImport")(result);
    return host.innerHTML;
  };
  const pending = () => run("fleetPendingImportText");

  run('fleetPendingImportText = "a file"');
  const ok = finish({ ok: true, entry: { name: 'Q4 <b>"plan"</b>' } });
  check(
    "a finished import names the snapshot, escaped, and drops the pending text",
    ok.includes(
      "Imported &quot;Q4 &lt;b&gt;&quot;plan&quot;&lt;/b&gt;&quot;.",
    ) && pending() === null,
    ok.slice(0, 300),
  );

  run('fleetPendingImportText = "a file"');
  const dup = finish({
    ok: false,
    reason: "duplicate",
    name: "Q4",
    suggestion: "Q4 (2)",
  });
  check(
    "a taken name shows the rename form and keeps the text for it",
    dup.includes('id="fleetSnapshotImportForm"') &&
      dup.includes("Q4 (2)") &&
      pending() === "a file",
    dup.slice(0, 300),
  );

  const refused = finish({ ok: false, reason: "version" });
  check(
    "a refusal shows its own message and drops the pending text",
    refused.includes("different version") && pending() === null,
    refused.slice(0, 300),
  );
  check(
    "a refusal also drops the rename offer, so the two never disagree",
    run("fleetPendingImportOffer") === null,
  );

  run('fleetPendingImportText = "a file"');
  const unknown = finish({ ok: false, reason: "something-new" });
  check(
    "a reason with no message still says the file could not be imported",
    unknown.includes("could not be imported") && pending() === null,
    unknown.slice(0, 300),
  );

  // A rename left empty is the typed name's problem, not the file's: the file and the
  // form are kept and the message says what to do.
  run('fleetPendingImportText = "a file"');
  finish({ ok: false, reason: "duplicate", name: "Q4", suggestion: "Q4 (2)" });
  let typed = "   ";
  ctx.ctx.document.getElementById = (id) =>
    id === "fleetSnapshotsPanel"
      ? host
      : id === "fleetSnapshotImportName"
        ? { value: typed }
        : null;
  host.innerHTML = "";
  const handled = run("handleFleetSnapshotImportRename")({
    target: { matches: () => true },
    preventDefault() {},
  });
  check(
    "an empty rename asks for a name, keeps the form and the file, and does not blame the file",
    handled === true &&
      host.innerHTML.includes("Type a name to import the file as.") &&
      host.innerHTML.includes('id="fleetSnapshotImportForm"') &&
      !host.innerHTML.includes("has no name") &&
      pending() === "a file",
    host.innerHTML.slice(0, 300),
  );
  typed = "Q4 renamed";
  host.innerHTML = "";

  ctx.ctx.document.getElementById = realGet;
}

if (state.failures > 0) {
  console.log(`\n${state.failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("storage-manager-ui-test: all checks passed");
}
