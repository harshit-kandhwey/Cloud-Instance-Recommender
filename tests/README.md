# Tests

Plain-Node test harness — no framework, and no npm install for the core suites.

**This file is the single source of truth for testing.** What must be covered,
what the gates are, and what is deliberately left uncovered are all below. Other
docs link here rather than restating any of it.

## The gates

Six CI jobs run on every pull request and every push to `main`. A PR is green
only when all of them are.

| Command                      | What it proves                                              | CI job      |
| ---------------------------- | ----------------------------------------------------------- | ----------- |
| `npm run format:check`       | everything is Prettier-formatted                            | `format`    |
| `node tests/syntax-check.js` | every first-party JS file parses (`node --check`)           | `test`      |
| `node tests/run-all.js`      | all suites pass, and the golden outputs match byte for byte | `test`      |
| `npm run coverage:check`     | no user-reachable name is untested and unwaived             | `test`      |
| `npm run typecheck`          | `tsc --noEmit` over the `// @ts-check` modules              | `typecheck` |
| `npm run test:property`      | the engine invariants hold over randomised input            | `property`  |
| `npm run test:e2e`           | the real flow works in a real browser (Chromium + WebKit)   | `e2e`       |
| `npm run test:visual`        | the rendered pages still look right (Chromium)              | `visual`    |

`npm run test:mutation` is the one gate **outside** CI — periodic and manual,
because a legitimate refactor can move the score. See [Mutation](#mutation).

## Running them locally

The core loop needs nothing installed:

```bash
node tests/run-all.js            # all suites + golden byte-compare
node tests/run-all.js --smoke    # (npm run test:smoke) critical-path subset
node tests/syntax-check.js       # node --check over first-party JS
npm run coverage:check           # behavioral surface covered or waived
node tests/suites/ingest/column-mapping-test.js   # a single suite
```

`--smoke` runs only the suites named in `tests/smoke.json` (load → ingest →
generate → export) plus the golden compare — a ~3s local sanity pass versus the
full run. It is a **developer convenience, not a CI gate**: CI still runs the
full suite on every PR and on `main`. A `smoke.json` entry that names a suite
which no longer exists is a hard error, so the list can't silently rot.

The remaining gates need dev dependencies, which is why they are kept out of
`npm test`:

```bash
npm ci                                    # dev deps for everything below
npx playwright install chromium webkit    # one-time browser download (e2e)

npm run typecheck        # tsc --noEmit
npm run test:property    # fast-check engine invariants
npm run test:e2e         # Playwright, Chromium + WebKit
npm run test:visual      # visual regression, Chromium only
npm run format:check     # what `npm run format` would change
```

### Property gate

`tests/property/` runs hundreds of random pools and requests through the real
selector pipeline and asserts four guarantees: a matched box always meets the
requested size, a no-match happens exactly when nothing fits, a stricter target
never returns a cheaper box, and identical input yields an identical
recommendation. On failure fast-check prints the shrunk counterexample and a seed
to reproduce it.

### Mutation

StrykerJS, driven by `tests/mutation-run.js` — a single-process in-process oracle
(Stryker uses the command runner because no framework plugin understands this
repo's `vm` harness). Scoped to the engine core (`js/base/rule-engine.js` +
`js/base/instance-selector-factory.js`), where a survived mutant is a real test
hole.

```bash
npm ci
npm run test:mutation    # ~3 min; HTML report at reports/mutation/index.html
```

Baseline score at introduction is 53% (the `thresholds.break` in
`stryker.config.json` sits below it as a ratchet — raise it as the oracle grows,
never lower it). `tests/mutation-run.js` is NOT a substitute for `run-all.js`; it
is a fast, engine-scoped killer set that also folds in the property gate.

### Visual gate

`tests/visual/` + `playwright-visual.config.js` pin the rendered look of the four
provider pages in their empty, pre-upload state (`pages.visual.spec.js`) plus
three richer states (`states.visual.spec.js`): the dark theme, the
region-validation chips after an upload, and the populated results preview table.
So an accidental CSS/layout/token regression fails even when every functional
assertion still passes.

The catch with pixel baselines is that they are **OS- and engine-specific**: a
screenshot taken on Windows or macOS differs from ubuntu on font hinting alone.
So the committed baselines are the `-linux` set, generated on the ubuntu CI
runner — never on a contributor's machine. To (re)generate them, run the CI
workflow manually with `update_baselines=true` (Actions → CI → Run workflow):
the `visual` job regenerates the PNGs and uploads them as the
`visual-baselines-linux` artifact; download it, commit the PNGs under
`tests/visual/__screenshots__/`, and from then on the `visual` job compares
against them on every push/PR. Until those baselines are committed the gate is
**neutral** (the job skips the compare rather than failing red).

## What must be covered

The coverage gate is a **tiered policy, not a percentage** — there is no line- or
branch-coverage target anywhere in this repo, deliberately. The rule, enforced by
`tools/build-coverage-inventory.js --check` and reported in
[coverage-inventory.md](coverage-inventory.md):

- **The surface** is every top-level `function NAME()` and `window.NAME =` across
  `js/`, excluding vendored builds, the generated region files, and the
  `*-data.js` manifests. These are classic scripts, so every top-level function
  really is a window property that a page or the worker calls by name.
- **Behavioral tier — must be covered or waived.** A name a user can reach: an
  `onclick=` on a real page element, a handler in generated markup, an
  `addEventListener` target, or a name the recommendation worker calls. A
  behavioral name with no suite and no waiver is a **gap**, and the gate fails.
- **Internal tier — waivable in bulk.** A helper reached only through another
  function. Still never skipped by accident: every waiver carries a written
  reason in [coverage-waivers.json](coverage-waivers.json).
- **The tier is derived, not declared.** The tool reads the pages and the JS to
  decide what is reachable, so a name cannot be demoted to "internal" by opinion.
- **Coverage is execution-based, not source-text.** The tool runs every suite
  under V8's coverage collector; a name counts as covered only when a suite
  actually ran it. It also exits 1 if any suite fails during that pass, since a
  partial run cannot produce a trustworthy ledger.

Why tiered: one suite per exported function, over the several hundred globals
this app defines, is unfinishable — and an unfinishable gate gets switched off.
Gating the reachable surface is the part that stays honest.

**Writing the test itself is a separate discipline from choosing what to test: a
guard is not finished until you have planted the bug it exists to catch and
watched it go red.** Several guards in this repo passed against a real planted
bug, so this is not a formality.

## What is NOT covered

Stated plainly, because a gate's silence reads as approval:

- **`tools/` is outside the coverage ledger entirely.** The surface scan walks
  `js/` only, so not one build-tool function appears among the names the gate
  counts. The tools _are_ tested — `suites/infra/` drives the fetchers, the
  reconciler, both diffs, the shared helpers and the splitter — but nothing
  _requires_ that, and nothing reports which tool function has no test. That gap
  is not theoretical: `tools/split-data.js` rewrote every shipped data file for
  several releases with no suite of its own, and two build tools were found
  reading region records through private loops that no test named.
- **Waived behavioral names.** Real, reachable code the gate accepts on a written
  reason rather than a test. The ledger lists each one with its waiver.
- **Uncovered internal helpers.** Allowed by tier, unlisted by policy — the
  ledger names them all.
- **A line that ran is not a line that was checked.** Coverage cannot tell a real
  assertion from a call with no oracle behind it. Only the mutation gate answers
  that, and it is scoped to two engine files.
- **The suites are not a browser.** They run in `vm` against a simulated DOM, so
  real layout, real event dispatch, real storage and real workers are covered
  only by the `e2e` (Chromium + WebKit) and `visual` (Chromium) jobs.
- **The visual gate is neutral until its baselines are committed** — it skips
  rather than fails, so an empty `__screenshots__/` looks exactly like a pass.
- **Generated data is excluded from every gate.** The region files and the
  manifests are pinned by `suites/infra/data-integrity-test.js` for consistency,
  not by coverage.

## Layout

Suites are grouped by feature area. `run-all.js` and the coverage ledger both
recurse, so a suite is found at any nested path:

| Folder                 | What it covers                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `suites/ingest/`       | file upload, CSV/xlsx parsing, sheet & column mapping, paste, input hygiene                                              |
| `suites/engine/`       | core sizing — fit, families, generations, nearest-miss, the worker protocol & watchdog                                   |
| `suites/workload/`     | workload-class rules (burstable, GPU, SQL) and app→workload grouping                                                     |
| `suites/preview/`      | the results preview table — filters, visibility, pagination, search, staleness                                           |
| `suites/export/`       | downloads — CSV, xlsx, report, scenario compare, portfolio, no-match export                                              |
| `suites/manual-entry/` | the manual VM entry form and its bulk edit                                                                               |
| `suites/ui/`           | theme, accessibility, charts, presets, region validation, samples, ranges                                                |
| `suites/infra/`        | lazy region loading, monolith fallback, page parity, PWA, vendor integrity, data/manifest integrity, and the build tools |

`suites/harness.js` (the shared simulated-DOM sandbox) stays at the `suites/`
root — it is not a suite, so nothing runs it directly.

## How it works

- **`suites/**/*-test.js`** — each suite builds a small simulated-DOM sandbox
  (`vm.createContext` with stubbed `document`/`localStorage`/`Worker`),
  loads the real app scripts into it, and drives the actual functions:
  CSV/xlsx ingestion, column mapping, region validation, lazy region
  loading, the recommendation worker protocol, preview rendering,
  accessibility attributes, manual entry, and the split tool.
- **`golden/golden-run.js`** — runs the built-in sample CSV through the
  pure recommendation pipeline (rule engine + selectors + factory) and
  serializes exactly like `downloadResults()`. `run-all.js` byte-compares
  the output against `golden/goldens/*.csv`. Scenarios cover AWS
  like-to-like, the AWS/Azure/GCP multicloud blend, single-provider Azure
  and GCP (so a regression isolated to one selector shows on its own line),
  and a fully filtered-out AWS run that locks the No-Match reason and
  nearest-miss hint.

## Golden maintenance

The goldens are tied to the committed instance data (see
`window.{P}_DATA_DATE` in `js/{p}/{p}-data.js`). They change **only** when
the instance data is refreshed. To regenerate after a data update:

```bash
node --max-old-space-size=4096 tests/golden/golden-run.js . tests/golden/goldens
```

Review the diff before committing — golden changes should correspond to
real data changes, never to code changes.

## Conventions

- A suite exits 0 on success, non-zero on any failed check; `run-all.js`
  aggregates and prints per-suite PASS/FAIL.
- Suites are self-contained on purpose (each carries its own sandbox
  setup) so one suite's stubs can't silently change another's behavior.
