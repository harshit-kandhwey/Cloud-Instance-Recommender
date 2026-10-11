// build-env suite: pins scripts/lib/build-env.js — the generic Node/CI primitives
// (CLI flag reader, validated --date, the scratch-monolith path, atomic write) that
// every refresh/build tool depends on. No network.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeChecker } = require("../harness");
const {
  argValue,
  resolveDataDate,
  writeFileAtomic,
  monolithPath,
} = require("../../../scripts/lib/build-env");

const { check, state } = makeChecker();

// ── argValue: CLI flag reader (argv injectable) ─────────────────────────────────
{
  const argv = ["node", "tool.js", "--provider", "aws", "--flag"];
  check(
    "argValue reads the value after a flag",
    argValue("--provider", argv) === "aws",
  );
  check(
    "argValue is undefined for an absent flag",
    argValue("--missing", argv) === undefined,
  );
  check(
    "argValue is undefined for a trailing flag with no value",
    argValue("--flag", argv) === undefined,
  );
}

// ── monolithPath: one definition of where the refresh's scratch monolith lives ───
// Five tools agree on this path by importing it. The directory matters as much as the
// name: .refresh-cache/ is gitignored, so the scratch artifact can never ride along in
// a refresh PR, and it is NOT under js/, so the shipped tree survives every step of
// the pipeline except split-data.
{
  const p = monolithPath("aws", "/root");
  check(
    "monolithPath puts the scratch monolith in .refresh-cache/, outside js/",
    p.replace(/\\/g, "/") === "/root/.refresh-cache/aws-monolith.js",
    p,
  );
  const ignored = fs
    .readFileSync(path.join(__dirname, "..", "..", "..", ".gitignore"), "utf8")
    .split(/\r?\n/)
    .some((l) => l.trim() === ".refresh-cache/");
  check("and .refresh-cache/ is gitignored, so it cannot reach a PR", ignored);
}

// ── resolveDataDate: the value that reaches the user-visible freshness badge ─────
{
  check(
    "resolveDataDate passes a real calendar date through",
    resolveDataDate("2026-08-30") === "2026-08-30",
  );
  check(
    "resolveDataDate defaults to today when the flag is absent",
    resolveDataDate(undefined, new Date("2026-08-30T11:22:33Z")) ===
      "2026-08-30",
  );

  // Guard (plant-RED: drop the validation and return the argument): --date is
  // serialized into {PREFIX}_DATA_DATE, which the page renders verbatim in the
  // "Instance data updated" badge — an unchecked value ships to users as-is.
  // 2026-02-30 is the case a format check alone misses: Date rolls it to 03-02.
  for (const bad of ["invalid", "2026-02-30", "2026-13-01", "2026-8-3", ""]) {
    let msg = "";
    try {
      resolveDataDate(bad);
    } catch (e) {
      msg = e.message;
    }
    check(
      `resolveDataDate rejects ${JSON.stringify(bad)}`,
      msg.includes(`invalid --date ${bad}`),
      msg || "(did not throw)",
    );
  }
}

// ── writeFileAtomic: a failed write never truncates what it replaces ────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cir-atomic-"));
  const target = path.join(dir, "artifact.js");

  writeFileAtomic(target, "window.X = 1;\n");
  check(
    "writeFileAtomic writes the contents and leaves no .tmp behind",
    fs.readFileSync(target, "utf8") === "window.X = 1;\n" &&
      !fs.existsSync(`${target}.tmp`),
    fs.readdirSync(dir).join(","),
  );

  // Guard (plant-RED: writeFileSync straight to the target): force the write to
  // fail by occupying the temp path with a directory. The previous artifact must
  // survive intact — a truncated monolith breaks readShippedRegionKeys on the next
  // run, which is the failure this replaced.
  fs.mkdirSync(`${target}.tmp`);
  let threw = false;
  try {
    writeFileAtomic(target, "window.X = 2;\n");
  } catch {
    threw = true;
  }
  check(
    "a failed writeFileAtomic throws and leaves the previous artifact intact",
    threw && fs.readFileSync(target, "utf8") === "window.X = 1;\n",
    fs.readFileSync(target, "utf8"),
  );

  fs.rmSync(dir, { recursive: true, force: true });
}

// ── The refresh pipeline writes its artifacts through that helper, not raw ───────
// Structural: every tool in the pipeline writes a durable artifact another step or
// the shipped page then reads, so a torn or truncated file from any one of them has
// the same cost. Pinned as a set because the guard that matters is the one nobody
// remembers to copy into the next tool.
{
  const pipeline = [
    "fetch-official-aws.js",
    "fetch-official-azure.js",
    "fetch-official-gcp.js",
    "fetch-vantage.js",
    "reconcile-data.js",
    "recommendation-diff.js",
    "split-data.js",
    "refresh-local.js",
  ];
  const raw = pipeline.filter((f) =>
    fs
      .readFileSync(
        path.join(__dirname, "..", "..", "..", "scripts", "data", f),
        "utf8",
      )
      .includes("fs.writeFileSync("),
  );
  check(
    "no refresh tool writes an artifact with a raw fs.writeFileSync",
    raw.length === 0,
    raw.join(",") || "none",
  );
}

// ── fetchJson: bounded retry on a stub transport (no network, no real sleeping) ───
async function runFetchJsonSuite() {
  const {
    fetchJson,
    parseRetryAfterMs,
  } = require("../../../scripts/lib/build-env");

  /** A stub response carrying just what fetchJson reads. */
  const reply = (status, body, retryAfter) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) => (k === "retry-after" ? (retryAfter ?? null) : null),
    },
    json: async () => body,
  });
  /** A transport that plays the given outcomes in order; a function entry throws. */
  const transport = (...outcomes) => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      const o = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
      if (o instanceof Error) throw o;
      return o;
    };
    return { fetchImpl, calls };
  };
  const waits = [];
  const sleepImpl = async (ms) => {
    waits.push(ms);
  };
  const run = async (t, opts = {}) => {
    waits.length = 0;
    try {
      const value = await fetchJson("https://x.test/a", {
        timeoutMs: 1000,
        fetchImpl: t.fetchImpl,
        sleepImpl,
        ...opts,
      });
      return { value, waits: waits.slice() };
    } catch (error) {
      return { error, waits: waits.slice() };
    }
  };

  {
    const t = transport(reply(200, { ok: 1 }));
    const r = await run(t);
    check(
      "fetchJson: a first-try success makes one request and never sleeps",
      r.value &&
        r.value.ok === 1 &&
        t.calls.length === 1 &&
        r.waits.length === 0,
    );
  }
  {
    const t = transport(
      reply(429, null),
      reply(429, null),
      reply(200, { ok: 3 }),
    );
    const r = await run(t);
    check(
      "fetchJson: succeeds on the third try after two 429s",
      r.value && r.value.ok === 3 && t.calls.length === 3,
      JSON.stringify(r.error && r.error.message),
    );
    check(
      "fetchJson: backoff doubles between attempts (1000 then 2000)",
      JSON.stringify(r.waits) === "[1000,2000]",
      JSON.stringify(r.waits),
    );
  }
  {
    const t = transport(reply(429, null, "7"), reply(200, { ok: 1 }));
    const r = await run(t);
    check(
      "fetchJson: Retry-After seconds are honoured instead of the backoff",
      r.value && JSON.stringify(r.waits) === "[7000]",
      JSON.stringify(r.waits),
    );
  }
  {
    const t = transport(reply(429, null, "999"), reply(200, { ok: 1 }));
    const r = await run(t, { maxDelayMs: 5000 });
    check(
      "fetchJson: a huge Retry-After is capped at maxDelayMs",
      r.value && JSON.stringify(r.waits) === "[5000]",
      JSON.stringify(r.waits),
    );
  }
  {
    const t = transport(reply(429, null));
    const r = await run(t, {
      attempts: 3,
      errorContext: "for region mexicocentral",
    });
    const msg = r.error ? r.error.message : "";
    check(
      "fetchJson: gives up after the attempt limit",
      !!r.error && t.calls.length === 3,
      String(t.calls.length),
    );
    check(
      "fetchJson: the final error names the status, the region and the attempts",
      msg ===
        "fetch failed: HTTP 429 for region mexicocentral (after 3 attempts)",
      msg,
    );
    check(
      "fetchJson: it does not sleep after the last attempt",
      r.waits.length === 2,
      JSON.stringify(r.waits),
    );
  }
  {
    const t = transport(reply(404, null), reply(200, { ok: 1 }));
    const r = await run(t, { errorContext: "for region nowhere" });
    check(
      "fetchJson: a 404 is not retried and keeps its original message",
      t.calls.length === 1 &&
        r.error &&
        r.error.message === "fetch failed: HTTP 404 for region nowhere",
      r.error && r.error.message,
    );
  }
  {
    const t = transport(reply(400, null), reply(200, { ok: 1 }));
    const r = await run(t);
    check("fetchJson: a 400 is not retried", t.calls.length === 1 && !!r.error);
  }
  {
    const t = transport(reply(503, null), reply(200, { ok: 1 }));
    const r = await run(t);
    check("fetchJson: a 503 is retried", r.value && t.calls.length === 2);
  }
  {
    const t = transport(new TypeError("fetch failed"), reply(200, { ok: 1 }));
    const r = await run(t);
    check(
      "fetchJson: a network error or timeout is retried",
      r.value && t.calls.length === 2,
      r.error && r.error.message,
    );
  }
  {
    const t = transport(new TypeError("socket hang up"));
    const r = await run(t, { attempts: 2, errorContext: "for region r" });
    check(
      "fetchJson: a persistent network error ends with the reason and the count",
      r.error &&
        r.error.message ===
          "fetch failed: socket hang up for region r (after 2 attempts)",
      r.error && r.error.message,
    );
  }
  {
    // A 200 whose body then fails to arrive: the status was fine, the read was not.
    const brokenBody = (message) => ({
      ...reply(200, null),
      json: async () => {
        throw new TypeError(message);
      },
    });
    const t = transport(brokenBody("terminated"), reply(200, { ok: 7 }));
    const r = await run(t);
    check(
      "fetchJson: a body that fails to arrive is retried like any transport error",
      r.value && r.value.ok === 7 && t.calls.length === 2,
      r.error && r.error.message,
    );
    const t2 = transport(brokenBody("terminated"));
    const r2 = await run(t2, { attempts: 2, errorContext: "for region r" });
    check(
      "fetchJson: a body that never arrives ends with the reason and the count",
      r2.error &&
        r2.error.message ===
          "fetch failed: terminated for region r (after 2 attempts)" &&
        t2.calls.length === 2,
      r2.error && r2.error.message,
    );
  }
  {
    const now = Date.parse("2026-10-11T00:00:00Z");
    check("parseRetryAfterMs: seconds", parseRetryAfterMs("5") === 5000);
    check(
      "parseRetryAfterMs: an HTTP date is read relative to now",
      parseRetryAfterMs("Sun, 11 Oct 2026 00:00:30 GMT", now) === 30000,
    );
    check(
      "parseRetryAfterMs: a past date is zero, not negative",
      parseRetryAfterMs("Sun, 11 Oct 2026 00:00:00 GMT", now + 5000) === 0,
    );
    check(
      "parseRetryAfterMs: garbage and absent are null",
      parseRetryAfterMs("soon") === null && parseRetryAfterMs(null) === null,
    );
  }
}

runFetchJsonSuite()
  .catch((err) => {
    console.error(err);
    state.failures++;
  })
  .then(() => {
    if (state.failures) {
      console.error(`\nbuild-env: ${state.failures} check(s) FAILED`);
      process.exitCode = 1;
    } else {
      console.log("\nbuild-env: all checks passed");
      process.exitCode = 0;
    }
  });
