// inventory-limits suite: how much one input may hold. Nothing capped a CSV's rows, a
// workbook's decompressed size, or an imported rules or presets file, so a file that is
// not an inventory (a database dump, a workbook that expands from megabytes to
// gigabytes, a rules file of fifty thousand entries) was parsed in full while the tab
// froze. Covered: the row and column limits at their exact edges and at every route,
// the declared-size check on a workbook before the parser allocates (real and crafted
// archives), that a refusal leaves the previous upload loaded, and the two JSON
// imports. The limits themselves are named constants in the sources they guard.
const path = require("path");
const {
  REPO,
  buildContext,
  buildEngineContext,
  makeChecker,
  rowsOf,
} = require("../harness");
const XLSX = require(path.join(REPO, "js/vendor/xlsx.full.min.js"));

const { check, state } = makeChecker();

// A ZIP with only a central directory: one entry per declared size, then the end record.
// That is all zipDeclaredUncompressedBytes reads.
function craftedZip(declaredSizes) {
  const parts = [];
  let cdSize = 0;
  declaredSizes.forEach((size, i) => {
    const name = Buffer.from(`f${i}`);
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt32LE(size >>> 0, 24);
    h.writeUInt16LE(name.length, 28);
    parts.push(h, name);
    cdSize += 46 + name.length;
  });
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(declaredSizes.length, 8);
  end.writeUInt16LE(declaredSizes.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(0, 16);
  parts.push(end);
  const buf = Buffer.concat(parts);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

(async () => {
  const { ctx, run, elements } = buildContext();
  const MAX_ROWS = run("MAX_INVENTORY_ROWS");
  const MAX_COLS = run("MAX_INVENTORY_COLUMNS");
  const MAX_ZIP = run("MAX_XLSX_UNCOMPRESSED_BYTES");

  // ── the row and column limits ─────────────────────────────────────────────────
  check(
    "the limits are the generous round numbers the docs state",
    MAX_ROWS === 100000 && MAX_COLS === 500 && MAX_ZIP === 200 * 1024 * 1024,
    `${MAX_ROWS} ${MAX_COLS} ${MAX_ZIP}`,
  );
  check(
    "a file at exactly the row limit fits",
    run(`inventoryLimitMessage(${MAX_ROWS}, 10)`) === null,
  );
  check(
    "one row over is refused with the count and the limit named",
    /100,001 rows; the limit is 100,000/.test(
      run(`inventoryLimitMessage(${MAX_ROWS + 1}, 10)`),
    ),
  );
  check(
    "a file at exactly the column limit fits, one over is refused",
    run(`inventoryLimitMessage(10, ${MAX_COLS})`) === null &&
      /501 columns; the limit is 500/.test(
        run(`inventoryLimitMessage(10, ${MAX_COLS + 1})`),
      ),
  );
  check(
    "the record counter counts records, not physical lines",
    run(`countCsvRecords("a\\nb\\nc")`) === 3 &&
      run(`countCsvRecords("")`) === 0 &&
      run(`countCsvRecords("a\\n")`) === 1 &&
      run(`countCsvRecords("a\\nb\\n")`) === 2 &&
      run(`countCsvRecords('h\\n"x\\ny",2\\n')`) === 2 &&
      run(`countCsvRecords("h\\n\\n  \\nz\\n")`) === 2,
  );
  {
    // The counter is a second reader of the same format; it must agree with the
    // parser's own record splitter on every shape, or the refusal names a wrong count.
    const texts = [
      "",
      "a",
      "a\n",
      "a\nb\nc",
      "a\n\n\nb",
      "a\r\nb\r\n",
      "a\rb\r",
      '"x\ny",2\nz',
      'a,"b""c\nd"\ne',
      '"unterminated\nstill going',
      "   \n\t\n z",
      '""\n',
      "﻿a\n \nb",
    ];
    const disagree = texts.filter((t) => {
      ctx.__t = t;
      return (
        run("countCsvRecords(__t)") !==
        run('splitRecords(__t).filter((r) => r.trim() !== "").length')
      );
    });
    check(
      "the record counter agrees with the parser's record splitter on every shape",
      disagree.length === 0,
      JSON.stringify(disagree),
    );
  }

  // ── the declared size of a workbook ───────────────────────────────────────────
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["VM Name"], ["a"]]),
      "Data",
    );
    const real = new Uint8Array(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    );
    ctx.__zip = real;
    const size = run("zipDeclaredUncompressedBytes(__zip)");
    check(
      "a real workbook reports a small positive declared size",
      Number.isFinite(size) && size > 0 && size < 1024 * 1024,
      String(size),
    );
    ctx.__zip = new Uint8Array([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24,
    ]);
    check(
      "bytes that are not a ZIP report null",
      run("zipDeclaredUncompressedBytes(__zip)") === null,
    );
    ctx.__zip = craftedZip([1000, 2000, 3000]);
    check(
      "a crafted archive's entries are summed",
      run("zipDeclaredUncompressedBytes(__zip)") === 6000,
    );
    ctx.__zip = craftedZip([0xffffffff]);
    check(
      "an entry that needs ZIP64 counts as unbounded",
      run("zipDeclaredUncompressedBytes(__zip)") === Infinity,
    );
    const truncated = craftedZip([10, 20]);
    // Two entries are declared but the second is cut short before the end record.
    ctx.__zip = new Uint8Array(
      Buffer.concat([
        Buffer.from(truncated.slice(0, 60)),
        Buffer.from(truncated.slice(truncated.length - 22)),
      ]),
    );
    check(
      "a central directory that runs off the end reports null, not a number",
      run("zipDeclaredUncompressedBytes(__zip)") === null,
    );
  }

  // ── a refusal leaves the previous upload in place ─────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  {
    for (const key of Object.keys(elements)) delete elements[key];
    ctx.FileReader = class {
      /** @type {any} */
      onload = null;
      readAsText() {
        setTimeout(
          () =>
            this.onload({
              target: {
                result: "VM Name,CPU Count,Memory (GB)\nkeep-me,2,8\n",
              },
            }),
          0,
        );
      }
    };
    await ctx.ingestFile({ name: "good.csv", size: 40 });
    await sleep(30);
    const before = rowsOf(ctx)[0]["VM Name"];

    // Something a teardown (resetIngestState) would clear: if it survives, the refusal
    // came before the previous upload was touched.
    const survives = () =>
      run("JSON.stringify(window._uploadedSheets)") === '["marker"]';
    run('window._uploadedSheets = ["marker"]');
    // a CSV whose line count is over the limit
    const bigText =
      "VM Name,CPU Count,Memory (GB)\n" + "x,1,1\n".repeat(MAX_ROWS + 1);
    ctx.FileReader = class {
      /** @type {any} */
      onload = null;
      readAsText() {
        setTimeout(() => this.onload({ target: { result: bigText } }), 0);
      }
    };
    await ctx.ingestFile({ name: "huge.csv", size: 1000 });
    await sleep(60);
    const html = elements.fileStatus ? elements.fileStatus.innerHTML : "";
    check(
      "an over-long CSV is refused with the limit named",
      html.includes("the limit is 100,000"),
      html.slice(0, 160),
    );
    check(
      "and the previous upload is untouched: its rows and its sheet state are still there",
      before === "keep-me" &&
        rowsOf(ctx)[0]["VM Name"] === "keep-me" &&
        survives(),
      String(rowsOf(ctx)[0] && rowsOf(ctx)[0]["VM Name"]),
    );

    // a workbook that declares an enormous expansion
    const bomb = craftedZip([MAX_ZIP + 1]);
    for (const key of Object.keys(elements)) delete elements[key];
    await ctx.ingestFile({
      name: "bomb.xlsx",
      size: bomb.byteLength,
      arrayBuffer: async () =>
        bomb.buffer.slice(bomb.byteOffset, bomb.byteOffset + bomb.byteLength),
    });
    const bombHtml = elements.fileStatus ? elements.fileStatus.innerHTML : "";
    check(
      "a workbook declaring more than the limit is refused before it is parsed",
      bombHtml.includes("expands to more than 200 MB"),
      bombHtml.slice(0, 200),
    );
    check(
      "and the previous upload is still loaded after it too",
      rowsOf(ctx)[0]["VM Name"] === "keep-me",
    );

    // a workbook with a sheet over the row limit (small on disk, large in rows)
    {
      for (const key of Object.keys(elements)) delete elements[key];
      const aoa = [["VM Name"]];
      for (let i = 0; i <= MAX_ROWS; i++) aoa.push(["v"]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Data");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const bytes = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      );
      await ctx.ingestFile({
        name: "tall.xlsx",
        size: bytes.byteLength,
        arrayBuffer: async () => bytes,
      });
      const tallHtml = elements.fileStatus ? elements.fileStatus.innerHTML : "";
      check(
        "a workbook sheet over the row limit is refused with the limit named",
        tallHtml.includes("the limit is 100,000"),
        tallHtml.slice(0, 200),
      );
      check(
        "and the previous upload is untouched here too",
        rowsOf(ctx)[0]["VM Name"] === "keep-me" && survives(),
      );
    }

    // the one door every route passes
    for (const key of Object.keys(elements)) delete elements[key];
    const rows = Array.from({ length: MAX_ROWS + 1 }, () => ({
      "VM Name": "v",
      "CPU Count": "1",
      "Memory (GB)": "1",
    }));
    ctx.__rows = rows;
    run(`ingestRows(["VM Name", "CPU Count", "Memory (GB)"], __rows)`);
    check(
      "ingestRows refuses an over-long set whatever route it came by",
      (elements.fileStatus ? elements.fileStatus.innerHTML : "").includes(
        "the limit is 100,000",
      ) && rowsOf(ctx)[0]["VM Name"] === "keep-me",
    );

    // A file of exactly the limit that ends with a newline, as nearly every export does,
    // is not one row over.
    for (const key of Object.keys(elements)) delete elements[key];
    const exactText =
      "VM Name,CPU Count,Memory (GB)\n" + "x,1,1\n".repeat(MAX_ROWS);
    ctx.FileReader = class {
      /** @type {any} */
      onload = null;
      readAsText() {
        setTimeout(() => this.onload({ target: { result: exactText } }), 0);
      }
    };
    await ctx.ingestFile({ name: "exact.csv", size: 1000 });
    await sleep(2000);
    const exactHtml = elements.fileStatus ? elements.fileStatus.innerHTML : "";
    check(
      "a CSV of exactly the row limit, ending with a newline, is not refused",
      !exactHtml.includes("the limit is") && rowsOf(ctx).length === MAX_ROWS,
      `${rowsOf(ctx).length} rows; ${exactHtml.slice(0, 160)}`,
    );

    // Records, not lines: every record here holds a two-line quoted cell, so the file
    // has twice the limit in physical lines and exactly the limit in records.
    for (const key of Object.keys(elements)) delete elements[key];
    const multiText =
      "VM Name,CPU Count,Memory (GB),Notes\n" +
      'x,1,1,"first line\nsecond line"\n'.repeat(MAX_ROWS);
    ctx.FileReader = class {
      /** @type {any} */
      onload = null;
      readAsText() {
        setTimeout(() => this.onload({ target: { result: multiText } }), 0);
      }
    };
    await ctx.ingestFile({ name: "multiline.csv", size: 1000 });
    await sleep(3000);
    const multiHtml = elements.fileStatus ? elements.fileStatus.innerHTML : "";
    check(
      "a file at the record limit whose cells span lines is not refused",
      !multiHtml.includes("the limit is") && rowsOf(ctx).length === MAX_ROWS,
      `${rowsOf(ctx).length} rows; ${multiHtml.slice(0, 160)}`,
    );

    // One record over is refused with the true record count, not the line count.
    for (const key of Object.keys(elements)) delete elements[key];
    const overText =
      "VM Name,CPU Count,Memory (GB),Notes\n" +
      'x,1,1,"first line\nsecond line"\n'.repeat(MAX_ROWS + 1);
    ctx.FileReader = class {
      /** @type {any} */
      onload = null;
      readAsText() {
        setTimeout(() => this.onload({ target: { result: overText } }), 0);
      }
    };
    await ctx.ingestFile({ name: "multiline-over.csv", size: 1000 });
    await sleep(200);
    const overHtml = elements.fileStatus ? elements.fileStatus.innerHTML : "";
    check(
      "one record over is refused and the count named is the record count",
      overHtml.includes("100,001 rows; the limit is 100,000"),
      overHtml.slice(0, 160),
    );
  }

  // ── imported JSON ─────────────────────────────────────────────────────────────
  {
    const rules = Array.from({ length: 501 }, () => ({ dimension: "env" }));
    ctx.__payload = { rules };
    const v = run("validateUserRulesImport(__payload)");
    check(
      "a rules file over the count limit is refused with the limit named",
      v.ok === false && /at most 500/.test(v.error),
      JSON.stringify(v),
    );
    ctx.__payload = { rules: rules.slice(0, 500) };
    const within = run("validateUserRulesImport(__payload)");
    check(
      "500 entries are not refused for their number (these are just not valid rules)",
      !/at most/.test(String(within.error)),
      JSON.stringify(within),
    );
    const statusEl = { textContent: "", style: {} };
    elements.userRulesStatus = statusEl;
    ctx.__text = "x".repeat(1024 * 1024 + 1);
    run("applyUserRulesImportText(__text)");
    check(
      "a rules file over 1 MB is refused before it is parsed",
      /larger than 1 MB/.test(statusEl.textContent),
      statusEl.textContent,
    );
  }
  {
    const { ctx: pctx, run: prun } = buildEngineContext({
      scripts: ["src/shared/storage-keys.js", "src/features/presets.js"],
      label: "inventory-limits-presets",
    });
    const status = { textContent: "", style: {} };
    pctx.document = {
      getElementById: (id) => (id === "presetStatus" ? status : null),
      addEventListener() {},
    };
    const many = {};
    for (let i = 0; i < 201; i++) many[`p${i}`] = { config: {} };
    pctx.__payload = { presets: many };
    const v = prun("validatePresetImport(__payload)");
    check(
      "a presets file over the count limit is refused with the limit named",
      v.ok === false && /at most 200/.test(v.error),
      JSON.stringify(v),
    );
    const ok = {};
    for (let i = 0; i < 200; i++) ok[`p${i}`] = { config: {} };
    pctx.__payload = { presets: ok };
    check(
      "200 presets are accepted",
      prun("validatePresetImport(__payload)").ok === true,
    );
    pctx.__text = "x".repeat(1024 * 1024 + 1);
    prun("applyPresetImportText(__text)");
    check(
      "a presets file over 1 MB is refused before it is parsed",
      /larger than 1 MB/.test(status.textContent),
      status.textContent,
    );
  }

  if (state.failures) {
    console.error(`\ninventory-limits: ${state.failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("\ninventory-limits: all checks passed");
    process.exitCode = 0;
  }
})();
