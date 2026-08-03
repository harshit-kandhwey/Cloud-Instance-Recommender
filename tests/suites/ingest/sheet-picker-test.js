// Multi-sheet .xlsx: the inventory sheet is opened, not merely the first one,
// the choice stays visible and changeable, and a workbook that identifies itself
// as an RVTools export is read on its own terms.
//
// Builds real workbooks with the vendored SheetJS and drives ingestFile().
const path = require("path");
const {
  REPO,
  buildContext,
  makeChecker,
  rowsOf,
  parse,
} = require("../harness");

const XLSX = require(path.join(REPO, "js/vendor/xlsx.full.min.js"));

const { check, state } = makeChecker();

function makeXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, aoa } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const fakeFile = (name, arrayBuffer) => ({
  name,
  size: arrayBuffer.byteLength,
  arrayBuffer: async () => arrayBuffer,
  text: async () => Buffer.from(arrayBuffer).toString("utf8"),
  slice: (a, b) => ({ arrayBuffer: async () => arrayBuffer.slice(a, b) }),
});

const INVENTORY_HEADERS = ["VM Name", "CPU Count", "Memory (GB)", "AWS Region"];
const inventory = (...names) => [
  INVENTORY_HEADERS,
  ...names.map((n, i) => [n, 4 + i, 16, "us-east-1"]),
];

// An RVTools export: the VM inventory is in vInfo, behind a metadata tab, and
// followed by tabs that describe the same VMs from other angles.
const RVTOOLS = [
  {
    name: "vMetaData",
    aoa: [
      ["Metadata item", "Value"],
      ["Author", "RVTools"],
    ],
  },
  { name: "vInfo", aoa: inventory("web-01", "db-02", "app-03") },
  {
    name: "vCPU",
    aoa: [
      ["VM", "Sockets"],
      ["web-01", 2],
    ],
  },
];

(async () => {
  console.log("[the inventory sheet is opened, not the first sheet]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(fakeFile("rvtools.xlsx", makeXlsx(RVTOOLS)));

    // The whole point: SheetNames[0] is vMetaData, and reading it would have
    // produced two junk rows with no CPU or memory at all.
    check(
      "vInfo is read, though vMetaData comes first",
      rowsOf(ctx).length === 3 && rowsOf(ctx)[0]["VM Name"] === "web-01",
      JSON.stringify(rowsOf(ctx)),
    );
    check(
      "the picker is shown and preselects the sheet that was opened",
      !elements.sheetPickerSection.classes.has("hidden") &&
        /<option value="vInfo" selected>/.test(
          elements.sheetPickerSection.innerHTML,
        ),
    );
    check(
      "every readable sheet is offered, with its row count",
      ["vMetaData", "vInfo", "vCPU"].every((n) =>
        elements.sheetPickerSection.innerHTML.includes(`>${n} — `),
      ),
      elements.sheetPickerSection.innerHTML,
    );
  }

  console.log("[the user can override the choice]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "twins.xlsx",
        makeXlsx([
          { name: "First", aoa: inventory("from-first") },
          { name: "Second", aoa: inventory("from-second", "and-another") },
        ]),
      ),
    );
    ctx.selectSheet("Second");
    check(
      "switching sheets re-ingests from the chosen one",
      rowsOf(ctx).length === 2 && rowsOf(ctx)[0]["VM Name"] === "from-second",
      JSON.stringify(rowsOf(ctx)),
    );
    check(
      "the picker follows the switch",
      /<option value="Second" selected>/.test(
        elements.sheetPickerSection.innerHTML,
      ),
    );
    ctx.selectSheet("nope");
    check(
      "an unknown sheet name is ignored rather than blanking the data",
      rowsOf(ctx).length === 2,
    );
  }

  console.log(
    "[switching to a sheet that is not an inventory asks, not guesses]",
  );
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(fakeFile("rvtools.xlsx", makeXlsx(RVTOOLS)));
    ctx.selectSheet("vCPU"); // has VM and Sockets — no CPU count, no memory
    check(
      "the column-mapping panel opens rather than loading columns it cannot read",
      !elements.columnMappingSection.classes.has("hidden") &&
        rowsOf(ctx).length === 0,
      `rows=${JSON.stringify(rowsOf(ctx))}`,
    );
  }

  console.log("[sheets that are not data are not offered]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "gaps.xlsx",
        makeXlsx([
          { name: "Empty", aoa: [] },
          {
            name: "Blank header",
            aoa: [
              ["", ""],
              ["", ""],
            ],
          },
          { name: "Data", aoa: inventory("web-01") },
        ]),
      ),
    );
    check(
      "an empty tab and a headerless tab are skipped",
      !elements.sheetPickerSection.innerHTML.includes("Empty") &&
        !elements.sheetPickerSection.innerHTML.includes("Blank header"),
      elements.sheetPickerSection.innerHTML,
    );
    check(
      "one usable sheet left → no picker, and it is read",
      elements.sheetPickerSection.classes.has("hidden") &&
        rowsOf(ctx).length === 1,
    );
  }

  console.log("[unchanged where there is no choice to make]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "one.xlsx",
        makeXlsx([{ name: "Sheet1", aoa: inventory("web-01", "db-02") }]),
      ),
    );
    check(
      "a single-sheet workbook reads as before, with no picker",
      rowsOf(ctx).length === 2 &&
        elements.sheetPickerSection.classes.has("hidden"),
    );
  }
  {
    // Two sheets the scorer cannot tell apart: order decides, as it always did.
    const { ctx } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "twins.xlsx",
        makeXlsx([
          { name: "First", aoa: inventory("from-first") },
          { name: "Second", aoa: inventory("from-second") },
        ]),
      ),
    );
    check(
      "a tie falls back to workbook order",
      rowsOf(ctx)[0]["VM Name"] === "from-first",
      JSON.stringify(rowsOf(ctx)),
    );
  }

  console.log("[the picker never outlives the file it belongs to]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(fakeFile("rvtools.xlsx", makeXlsx(RVTOOLS)));
    check(
      "picker shown for the workbook",
      !elements.sheetPickerSection.classes.has("hidden"),
    );
    await ctx.ingestFile(
      fakeFile(
        "plain.csv",
        // A CSV goes down the FileReader path, not the workbook path — so the
        // workbook state must be cleared on the way, not by the sheet reader.
        new TextEncoder().encode("VM Name,CPU Count\nweb-01,4\n").buffer,
      ),
    );
    check(
      "uploading a CSV afterwards clears it, rather than offering the old sheets",
      elements.sheetPickerSection.classes.has("hidden") &&
        elements.sheetPickerSection.innerHTML === "" &&
        ctx.window._uploadedSheets === null,
    );
  }

  console.log("[a page without a picker still says what it opened]");
  {
    const { ctx, elements } = buildContext({
      missingElements: ["sheetPickerSection"],
    });
    await ctx.ingestFile(fakeFile("rvtools.xlsx", makeXlsx(RVTOOLS)));
    check(
      "the status line names the sheet, rather than reading one invisibly",
      /vInfo/.test(elements.fileStatus.innerHTML) &&
        /3 sheets/.test(elements.fileStatus.innerHTML),
      elements.fileStatus.innerHTML,
    );
    check("and it still reads the right sheet", rowsOf(ctx).length === 3);
  }

  // ── Import presets ─────────────────────────────────────────────────────────
  // A real RVTools vInfo header row: "VM" is the guest, "Host" is the ESXi box
  // it runs on, and "Memory" is MiB with nothing in the name to say so.
  const VINFO = [
    [
      "VM",
      "Powerstate",
      "DNS Name",
      "CPUs",
      "Memory",
      "Provisioned MiB",
      "Host",
      "Datacenter",
      "Cluster",
    ],
    [
      "web-01",
      "poweredOn",
      "web-01.corp",
      4,
      16384,
      102400,
      "esxi-07.corp",
      "DC1",
      "Prod",
    ],
    [
      "db-02",
      "poweredOn",
      "db-02.corp",
      8,
      65536,
      512000,
      "esxi-09.corp",
      "DC1",
      "Prod",
    ],
  ];

  console.log("[an RVTools export loads without being asked to map anything]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "rvtools-export.xlsx",
        makeXlsx([
          {
            name: "vMetaData",
            aoa: [
              ["Metadata item", "Value"],
              ["Author", "RVTools"],
            ],
          },
          { name: "vInfo", aoa: VINFO },
          {
            name: "vCPU",
            aoa: [
              ["VM", "Sockets"],
              ["web-01", 2],
            ],
          },
        ]),
      ),
    );
    const rows = rowsOf(ctx);

    // "VM" and "Host" are both VM-name synonyms, so an RVTools file is ambiguous
    // to the generic matcher and would stop to ask on every export. The preset
    // settles it without a prompt.
    check(
      "it does not stop to ask (the preset settles VM over Host)",
      elements.columnMappingSection.classes.has("hidden") && rows.length === 2,
      `rows=${rows.length}`,
    );
    check(
      "the guest is the VM, not the ESXi host it runs on",
      rows[0]["VM Name"] === "web-01",
      JSON.stringify(rows[0]),
    );
    // The bug this preset exists to prevent: "Memory" is MiB, and read as GB a
    // 16 GiB VM becomes a 16,384 GB VM that matches no instance anywhere.
    check(
      "MiB memory is converted, though the header never says MiB",
      rows[0]["Memory (GB)"] === "16" && rows[1]["Memory (GB)"] === "64",
      JSON.stringify(rows.map((r) => r["Memory (GB)"])),
    );
    check(
      "CPUs is read",
      rows[0]["CPU Count"] === "4" && rows[1]["CPU Count"] === "8",
    );
    check(
      "and the file says it was recognised, rather than reinterpreting silently",
      /Recognised as a RVTools export/.test(elements.fileStatus.innerHTML),
      elements.fileStatus.innerHTML,
    );
  }

  console.log("[a VM column is never silently mistaken for its hypervisor]");
  {
    // Same VM/Host collision, but nothing marks it as RVTools, so no preset can
    // settle it. It must ASK. The bug this guards: "host" was a VM-name synonym
    // and "vm" was not, so the ESXi box won unopposed and every guest on a
    // hypervisor took that hypervisor's name, silently.
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "unknown-tool.xlsx",
        makeXlsx([
          {
            name: "Sheet1",
            aoa: [
              ["VM", "CPUs", "Memory (GB)", "Host"],
              ["web-01", 4, 16, "esxi-07"],
              ["web-02", 4, 16, "esxi-07"],
            ],
          },
        ]),
      ),
    );
    check(
      "an unrecognised file with both columns asks instead of guessing",
      !elements.columnMappingSection.classes.has("hidden") &&
        rowsOf(ctx).length === 0,
      `rows=${JSON.stringify(rowsOf(ctx))}`,
    );
    check(
      "and it asks about the VM name specifically",
      /VM Name/.test(elements.columnMappingSection.innerHTML),
    );
  }

  console.log(
    "[the RVTools preset does not claim files it has not recognised]",
  );
  {
    // A hand-rolled vSphere export: VM, Powerstate and CPUs are all present —
    // but none of RVTools' MiB-suffixed sizing columns are, and its Memory
    // really is GB. The preset divides memory by 1024, so claiming this file
    // would corrupt every row of it.
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "custom-vsphere.xlsx",
        makeXlsx([
          {
            name: "VMs",
            aoa: [
              ["VM", "Powerstate", "CPUs", "Memory", "Cluster"],
              ["web-01", "poweredOn", 4, 16, "Prod"],
              ["db-02", "poweredOn", 8, 32, "Prod"],
            ],
          },
        ]),
      ),
    );
    check(
      "it is not announced as an RVTools export",
      !/Recognised as a RVTools export/.test(elements.fileStatus.innerHTML),
      elements.fileStatus.innerHTML,
    );
    check(
      "and its GB memory is left alone, not divided by 1024",
      rowsOf(ctx)
        .map((r) => r["Memory (GB)"])
        .join(",") === "16,32",
      JSON.stringify(rowsOf(ctx).map((r) => r["Memory (GB)"])),
    );
  }

  console.log(
    "[a recognised format keeps its units even when review is needed]",
  );
  {
    // A real RVTools export whose CPU and memory the preset settles — but with a
    // second app-ish column added by whoever exported it, so App Name is
    // ambiguous and the file stops at the mapping panel on the way in.
    //
    // The preset's knowledge that "Memory" is MiB has to survive that detour. It
    // was consulted only on the silent path, so the panel prefilled its unit from
    // the header instead — which says "Memory", and means GB — inviting the user
    // to confirm a 1024x error on a file already identified as MiB.
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "rvtools-custom.xlsx",
        makeXlsx([
          {
            name: "vInfo",
            aoa: [
              [
                "VM",
                "Powerstate",
                "CPUs",
                "Memory",
                "Provisioned MiB",
                "Application",
                "App",
              ],
              ["web-01", "poweredOn", 4, 16384, 102400, "Storefront", "SF"],
            ],
          },
        ]),
      ),
    );

    check(
      "the file does stop to ask (App Name is ambiguous)",
      !elements.columnMappingSection.classes.has("hidden") &&
        rowsOf(ctx).length === 0,
      `rows=${rowsOf(ctx).length}`,
    );
    check(
      "and the memory unit is prefilled MB from the recognised format",
      /<option value="MB" selected>/.test(
        elements.columnMappingSection.innerHTML,
      ),
      (elements.columnMappingSection.innerHTML.match(
        /colmap_unit_mem[\s\S]{0,240}/,
      ) || [])[0],
    );
  }

  // ── Shapes taken from two REAL RVTools exports (104 and 77 columns, 153 and
  // 875 VMs). Both of the bugs below were found by running those files through
  // this pipeline; neither was reachable by reasoning about the format.
  console.log(
    "[a spreadsheet's thousands separator does not destroy the value]",
  );
  {
    // RVTools writes Memory as "16,384" — the cell is formatted with a thousands
    // separator, in every export seen, across versions. parseFloat("16,384") is
    // 16: not an error, a WRONG ANSWER. Divided by 1024 as MiB, a 16 GiB VM
    // arrived as 0.02 GB and sized to the smallest instance on offer. Nothing
    // caught it: 0.02 is not zero, and the median was far below the MiB
    // threshold, so the unit question never fired either.
    const { ctx } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "rvtools.xlsx",
        makeXlsx([
          {
            name: "vInfo",
            aoa: [
              ["VM", "Powerstate", "CPUs", "Memory", "Provisioned MiB", "Host"],
              ["web-01", "poweredOn", 2, "4,096", "102,400", "esxi-07"],
              ["db-02", "poweredOn", 4, "8,192", "204,800", "esxi-07"],
              ["app-03", "poweredOn", 8, "16,384", "409,600", "esxi-09"],
            ],
          },
        ]),
      ),
    );
    check(
      "the grouped thousands are read as the number they are",
      rowsOf(ctx)
        .map((r) => r["Memory (GB)"])
        .join(",") === "4,8,16",
      JSON.stringify(rowsOf(ctx).map((r) => r["Memory (GB)"])),
    );
  }
  {
    // The other side of it: a comma that is NOT a thousands separator must be
    // left alone. In much of the world "3,5" is three and a half, and guessing
    // at a locale is how this class of bug starts.
    const { ctx } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "decimals.xlsx",
        makeXlsx([
          {
            name: "Sheet1",
            aoa: [
              ["VM Name", "CPU Count", "Memory (GB)"],
              ["odd-01", 2, "3,5"],
            ],
          },
        ]),
      ),
    );
    check(
      "an ambiguous comma is not silently rewritten",
      rowsOf(ctx)[0]["Memory (GB)"] === "3,5",
      JSON.stringify(rowsOf(ctx)[0]),
    );
  }

  console.log("[a recognised format decides which sheet is the inventory]");
  {
    // A real RVTools workbook has ~28 tabs, and vHost — the ESXi servers the VMs
    // run ON — can map MORE canonical-looking columns than vInfo, the VMs
    // themselves. Generic column counting duly opened vHost on a real export:
    // the wrong machines entirely. And with no VM/Powerstate column there, the
    // RVTools preset did not fire either, so it fell through to the mapping
    // panel. A sheet the preset RECOGNISES is the inventory; that must outrank
    // any amount of counting.
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "rvtools-28-tabs.xlsx",
        makeXlsx([
          {
            // Richer in mappable columns than vInfo: name, cpu, memory AND both
            // utilizations. It wins on generic score, and it is the wrong sheet.
            name: "vHost",
            aoa: [
              [
                "Host",
                "CPU Count",
                "Memory (GB)",
                "CPU Utilization",
                "Memory Utilization",
                "Datacenter",
              ],
              ["esxi-07", 64, 512, 40, 55, "DC1"],
              ["esxi-09", 64, 512, 35, 60, "DC1"],
            ],
          },
          {
            name: "vInfo",
            aoa: [
              ["VM", "Powerstate", "CPUs", "Memory", "Provisioned MiB", "Host"],
              ["web-01", "poweredOn", 2, "4,096", "102,400", "esxi-07"],
              ["db-02", "poweredOn", 4, "8,192", "204,800", "esxi-09"],
            ],
          },
        ]),
      ),
    );
    check(
      "vInfo is opened, not vHost",
      /<option value="vInfo" selected>/.test(
        elements.sheetPickerSection.innerHTML,
      ),
      elements.sheetPickerSection.innerHTML,
    );
    check(
      "so the VMs are loaded, not the servers they run on",
      rowsOf(ctx).length === 2 && rowsOf(ctx)[0]["VM Name"] === "web-01",
      JSON.stringify(rowsOf(ctx).map((r) => r["VM Name"])),
    );
    check(
      "the preset fires, so nothing is asked and the MiB is converted",
      elements.columnMappingSection.classes.has("hidden") &&
        rowsOf(ctx)
          .map((r) => r["Memory (GB)"])
          .join(",") === "4,8",
      JSON.stringify(rowsOf(ctx).map((r) => r["Memory (GB)"])),
    );
  }

  console.log("[an empty template sheet cannot beat the real inventory]");
  {
    // The template has MORE recognised columns than the populated sheet, and
    // scoring weighs recognised columns above row count — so a template merely
    // ranked low would still win, and the workbook would open empty.
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "with-template.xlsx",
        makeXlsx([
          {
            name: "Template",
            aoa: [
              [
                "VM Name",
                "CPU Count",
                "Memory (GB)",
                "AWS Region",
                "CPU Utilization",
                "Memory Utilization",
              ],
            ],
          },
          {
            name: "Inventory",
            aoa: [
              ["VM Name", "CPU Count", "Memory (GB)"],
              ["web-01", 4, 16],
              ["db-02", 8, 32],
            ],
          },
        ]),
      ),
    );
    check(
      "the populated sheet is opened",
      rowsOf(ctx).length === 2 && rowsOf(ctx)[0]["VM Name"] === "web-01",
      JSON.stringify(rowsOf(ctx)),
    );
    // Asserting only that "Template" is absent from the picker would pass for the
    // wrong reason: an excluded sheet leaves one candidate, and a one-sheet
    // workbook renders no picker at all, so the string is absent either way.
    check(
      "the template is not a candidate, so there is no picker to switch with",
      elements.sheetPickerSection.classes.has("hidden") &&
        elements.sheetPickerSection.innerHTML === "",
      elements.sheetPickerSection.innerHTML,
    );
    // And this is what makes the exclusion necessary rather than belt-and-braces:
    // given the choice, scoring PREFERS the template — it weighs recognised
    // columns above row count, and the template has more of them. Were it merely
    // ranked low it would still win, and the workbook would open empty.
    const asCandidates = [
      {
        name: "Template",
        headers: [
          "VM Name",
          "CPU Count",
          "Memory (GB)",
          "AWS Region",
          "CPU Utilization",
          "Memory Utilization",
        ],
        rows: [],
      },
      {
        name: "Inventory",
        headers: ["VM Name", "CPU Count", "Memory (GB)"],
        rows: [
          { "VM Name": "web-01", "CPU Count": "4", "Memory (GB)": "16" },
          { "VM Name": "db-02", "CPU Count": "8", "Memory (GB)": "32" },
        ],
      },
    ];
    // Call once and guard `.name`: a regression returning null/undefined must
    // report a named failure, not crash on the deref (which the detail arg,
    // evaluated eagerly, would do before check() even runs).
    const picked = ctx.pickBestSheet(asCandidates);
    check(
      "because scoring alone would choose the empty template over the real inventory",
      picked != null && picked.name === "Template",
      `scoring picked ${picked && picked.name} — if this is now "Inventory", the exclusion in readWorkbookSheet is no longer what protects this case`,
    );
  }

  console.log("[a rejected upload does not disturb the data already loaded]");
  {
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(fakeFile("rvtools.xlsx", makeXlsx(RVTOOLS)));
    check("a workbook is loaded, with its picker", rowsOf(ctx).length === 3);

    // Tearing state down BEFORE validating left a refused upload having already
    // removed the picker while the previous rows stayed loaded and generatable:
    // the controls that produced the data on screen would be gone, and the data
    // would not.
    await ctx.ingestFile(fakeFile("empty.csv", new ArrayBuffer(0)));
    check(
      "the rejection is explained",
      /File is empty/.test(elements.fileStatus.innerHTML),
      elements.fileStatus.innerHTML,
    );
    check(
      "the previous rows survive it",
      rowsOf(ctx).length === 3,
      String(rowsOf(ctx).length),
    );
    check(
      "and so does the sheet picker that produced them",
      !elements.sheetPickerSection.classes.has("hidden") &&
        /<option value="vInfo" selected>/.test(
          elements.sheetPickerSection.innerHTML,
        ),
      elements.sheetPickerSection.innerHTML,
    );
  }

  console.log("[an unrecognised MiB column is questioned, never converted]");
  {
    // Not RVTools, so nothing identifies the format and nothing in the header
    // says MB. The values look like MiB — but a fleet of 16 TB machines is not
    // impossible, only unlikely, so the file must ASK rather than divide.
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "generic.xlsx",
        makeXlsx([
          {
            name: "Sheet1",
            aoa: [
              ["VM Name", "CPU Count", "Memory"],
              ["web-01", 4, 16384],
              ["db-02", 8, 32768],
              ["app-03", 2, 8192],
            ],
          },
        ]),
      ),
    );
    check(
      "the values are left exactly as they were",
      rowsOf(ctx)
        .map((r) => r["Memory (GB)"])
        .join(",") === "16384,32768,8192",
      JSON.stringify(rowsOf(ctx).map((r) => r["Memory (GB)"])),
    );
    check(
      "and the question is put to the user",
      /Is the memory column in MB\?/.test(
        elements.inputHygieneSection.innerHTML,
      ) && /convertMemoryToGb\(\)/.test(elements.inputHygieneSection.innerHTML),
      elements.inputHygieneSection.innerHTML,
    );

    ctx.convertMemoryToGb();
    check(
      "answering MB converts, from the untouched source rows",
      rowsOf(ctx)
        .map((r) => r["Memory (GB)"])
        .join(",") === "16,32,8",
      JSON.stringify(rowsOf(ctx).map((r) => r["Memory (GB)"])),
    );
  }
  {
    // The reason this is a question and not a rule. A 512 GB–1 TB fleet is real,
    // and silently dividing it by 1024 would be the very corruption the MiB
    // handling exists to prevent, in the other direction.
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "big-iron.xlsx",
        makeXlsx([
          {
            name: "Sheet1",
            aoa: [
              ["VM Name", "CPU Count", "Memory"],
              ["sap-01", 64, 512],
              ["sap-02", 96, 768],
              ["sap-03", 128, 1024],
            ],
          },
        ]),
      ),
    );
    check(
      "a genuine high-memory fleet is not converted behind the user's back",
      rowsOf(ctx)
        .map((r) => r["Memory (GB)"])
        .join(",") === "512,768,1024",
      JSON.stringify(rowsOf(ctx).map((r) => r["Memory (GB)"])),
    );
    ctx.keepMemoryAsGb();
    check(
      "and saying they are GB puts the question away",
      elements.inputHygieneSection.classes.has("hidden") &&
        rowsOf(ctx)
          .map((r) => r["Memory (GB)"])
          .join(",") === "512,768,1024",
      elements.inputHygieneSection.innerHTML,
    );
  }
  {
    // Ordinary GB values raise nothing at all.
    const { ctx, elements } = buildContext();
    await ctx.ingestFile(
      fakeFile(
        "real-gb.xlsx",
        makeXlsx([
          {
            name: "Sheet1",
            aoa: [
              ["VM Name", "CPU Count", "Memory"],
              ["web-01", 4, 16],
              ["db-02", 8, 64],
              ["mainframe", 128, 4096], // one real 4 TB box
            ],
          },
        ]),
      ),
    );
    check(
      "one huge machine does not make the whole file suspect — the median decides",
      rowsOf(ctx)
        .map((r) => r["Memory (GB)"])
        .join(",") === "16,64,4096" &&
        !/Is the memory column in MB/.test(
          elements.inputHygieneSection.innerHTML,
        ),
      elements.inputHygieneSection.innerHTML,
    );
  }

  console.log(
    "[a recognised MiB file keeps its units even where there is no panel to say so]",
  );
  {
    // A page without #columnMappingSection applies a best-effort mapping instead
    // of asking. That path did not consult the preset — so a file we had ALREADY
    // identified as RVTools, and which needed review only because some other
    // column was ambiguous, had its memory read as GB. 16384 MiB arrived as
    // 16384 GB: a 1024x error, on a page with no dropdown for anyone to correct
    // it with, and a median far too high to trip the MiB question. Nothing would
    // have failed. Every VM in the file would simply have been sized enormous.
    //
    // "CPU Utilization" and "CPU Util" are both synonyms of the same canonical,
    // which is what makes the file need review despite being recognised.
    const RVT = `VM,Powerstate,CPUs,Memory,Provisioned MiB,In Use MiB,CPU Utilization,CPU Util
web-01,poweredOn,4,16384,20000,10000,45,45
db-02,poweredOn,8,32768,40000,20000,70,70`;

    const { ctx } = buildContext({ missingElements: ["columnMappingSection"] });
    parse(ctx, RVT);
    check(
      "the preset's MiB is honoured, not the header's word for it",
      rowsOf(ctx)
        .map((r) => r["Memory (GB)"])
        .join(",") === "16,32",
      `got ${JSON.stringify(rowsOf(ctx).map((r) => r["Memory (GB)"]))} — 16384/32768 means the units were dropped`,
    );

    // And the page that DOES have the panel prefills MB for the same file, so
    // the two paths cannot disagree about what the file is.
    const withPanel = buildContext();
    parse(withPanel.ctx, RVT);
    check(
      "and the page that asks prefills MB, so neither path can call it GB",
      /value="MB" selected|selected[^>]*value="MB"/.test(
        withPanel.elements.columnMappingSection.innerHTML,
      ),
      withPanel.elements.columnMappingSection.innerHTML.slice(0, 400),
    );
  }

  // process.exitCode, not process.exit(): exit() can truncate buffered stdout
  // when it is a pipe (the CI case), dropping the FAIL: lines the run just wrote.
  process.exitCode = state.failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
