// Manual entry: adding several similar VMs at once, and editing a row after the
// fact instead of deleting it and retyping it.
const vm = require("vm");
const { buildContext, makeChecker, rowsOf } = require("./harness");

const { check, state } = makeChecker();

const list = (ctx) => vm.runInContext("manualVMs", ctx);
const names = (ctx) => list(ctx).map((v) => v["VM Name"]);

// Fill the entry form the way a user would, then press a button.
function fill(ctx, values, copies) {
  ctx.toggleManualEntry(); // renders the form
  const defs = ctx.manualFieldDefs();
  defs.forEach((d, i) => {
    const input = ctx.document.getElementById(`manual_${i}`);
    if (Object.prototype.hasOwnProperty.call(values, d.key)) {
      input.value = String(values[d.key]);
    }
  });
  if (copies !== undefined) {
    ctx.document.getElementById("manualCopies").value = String(copies);
  }
}

console.log("[one VM keeps the name it was given]");
{
  const { ctx } = buildContext();
  fill(ctx, { "VM Name": "web-01", "CPU Count": "4", "Memory (GB)": "16" }, 1);
  ctx.manualAddVM();
  check(
    "no suffix is bolted onto a single VM",
    names(ctx).join(",") === "web-01",
    JSON.stringify(names(ctx)),
  );
}

console.log("[several similar VMs can be added at once]");
{
  const { ctx } = buildContext();
  fill(ctx, { "VM Name": "web", "CPU Count": "4", "Memory (GB)": "16" }, 5);
  ctx.manualAddVM();
  check(
    "five rows, numbered from the name",
    names(ctx).join(",") === "web-01,web-02,web-03,web-04,web-05",
    JSON.stringify(names(ctx)),
  );
  check(
    "and they share the specs that were typed once",
    list(ctx).every((v) => v["CPU Count"] === "4" && v["Memory (GB)"] === "16"),
    JSON.stringify(list(ctx)[0]),
  );
}

console.log("[a mistyped copy count cannot run away with the page]");
{
  const { ctx } = buildContext();
  fill(
    ctx,
    { "VM Name": "web", "CPU Count": "4", "Memory (GB)": "16" },
    100000,
  );
  ctx.manualAddVM();
  check(
    "the count is capped, not obeyed",
    list(ctx).length === 50,
    String(list(ctx).length),
  );
}
{
  const { ctx } = buildContext();
  fill(ctx, { "VM Name": "web", "CPU Count": "4", "Memory (GB)": "16" }, 0);
  ctx.manualAddVM();
  check("and a count of zero still adds one", list(ctx).length === 1);
}

console.log("[a row can be corrected instead of retyped]");
{
  const { ctx } = buildContext();
  fill(ctx, { "VM Name": "web-01", "CPU Count": "4", "Memory (GB)": "16" }, 1);
  ctx.manualAddVM();
  fill(ctx, { "VM Name": "db-01", "CPU Count": "8", "Memory (GB)": "32" }, 1);
  ctx.manualAddVM();

  ctx.manualEditVM(0);
  const defs = ctx.manualFieldDefs();
  check(
    "the form is prefilled from the row being edited",
    defs.find((d) => d.key === "VM Name").value === "web-01" &&
      defs.find((d) => d.key === "CPU Count").value === "4",
    JSON.stringify(defs.map((d) => [d.key, d.value])),
  );

  // Change it and save.
  defs.forEach((d, i) => {
    const input = ctx.document.getElementById(`manual_${i}`);
    if (d.key === "CPU Count") input.value = "16";
    if (d.key === "Memory (GB)") input.value = "64";
    if (d.key === "VM Name") input.value = "web-01";
  });
  ctx.manualSaveEdit();

  check(
    "the edited row is updated in place",
    list(ctx)[0]["CPU Count"] === "16" && list(ctx)[0]["Memory (GB)"] === "64",
    JSON.stringify(list(ctx)[0]),
  );
  check("and nothing was added", list(ctx).length === 2);
  check(
    "the other row is untouched",
    list(ctx)[1]["VM Name"] === "db-01" && list(ctx)[1]["CPU Count"] === "8",
    JSON.stringify(list(ctx)[1]),
  );
  check("edit mode is over", ctx.window._manualEditIndex === null);
}

console.log("[an invalid edit does not silently discard the row]");
{
  const { ctx, toasts } = buildContext();
  fill(ctx, { "VM Name": "web-01", "CPU Count": "4", "Memory (GB)": "16" }, 1);
  ctx.manualAddVM();

  ctx.manualEditVM(0);
  const defs = ctx.manualFieldDefs();
  defs.forEach((d, i) => {
    if (d.key === "CPU Count") {
      ctx.document.getElementById(`manual_${i}`).value = "0";
    }
  });
  ctx.manualSaveEdit();

  check(
    "the row keeps its old values",
    list(ctx)[0]["CPU Count"] === "4",
    JSON.stringify(list(ctx)[0]),
  );
  check(
    "the problem is stated",
    toasts.some((t) => /CPU Count and Memory/.test(t.message)),
    JSON.stringify(toasts),
  );
  check(
    "and it stays in edit mode rather than throwing the change away",
    ctx.window._manualEditIndex === 0,
  );
}

console.log(
  "[deleting rows never leaves the editor pointing at the wrong one]",
);
{
  const { ctx } = buildContext();
  for (const n of ["a", "b", "c"]) {
    fill(ctx, { "VM Name": n, "CPU Count": "4", "Memory (GB)": "16" }, 1);
    ctx.manualAddVM();
  }

  ctx.manualEditVM(2); // editing "c"
  ctx.manualRemoveVM(0); // delete "a", which sits BEFORE it
  check(
    "the index follows the row it was editing",
    ctx.window._manualEditIndex === 1 &&
      list(ctx)[ctx.window._manualEditIndex]["VM Name"] === "c",
    `index=${ctx.window._manualEditIndex} names=${names(ctx)}`,
  );

  ctx.manualRemoveVM(1); // delete "c" itself, the row under edit
  check(
    "and editing stops when that row is deleted",
    ctx.window._manualEditIndex === null && names(ctx).join(",") === "b",
    `index=${ctx.window._manualEditIndex} names=${names(ctx)}`,
  );
}

console.log("[clearing everything asks first, without a browser dialog]");
{
  const { ctx, elements } = buildContext();
  fill(ctx, { "VM Name": "web", "CPU Count": "4", "Memory (GB)": "16" }, 3);
  ctx.manualAddVM();

  ctx.manualConfirmClear();
  check(
    "it asks in the page",
    /Really remove all 3\?/.test(elements.manualEntrySection.innerHTML),
    elements.manualEntrySection.innerHTML.slice(0, 300),
  );
  check("and has not removed anything yet", list(ctx).length === 3);

  ctx.manualCancelClear();
  check("backing out keeps them", list(ctx).length === 3);

  ctx.manualConfirmClear();
  ctx.manualClearVMs();
  check("confirming clears them", list(ctx).length === 0);
}

console.log("[the rows still feed the normal pipeline]");
{
  const { ctx } = buildContext();
  fill(ctx, { "VM Name": "web", "CPU Count": "4", "Memory (GB)": "16" }, 3);
  ctx.manualAddVM();
  ctx.manualApplyVMs();
  check(
    "three bulk-added VMs arrive as three rows",
    rowsOf(ctx).length === 3 && rowsOf(ctx)[0]["VM Name"] === "web-01",
    JSON.stringify(rowsOf(ctx).map((r) => r["VM Name"])),
  );
}

process.exit(state.failures ? 1 : 0);
