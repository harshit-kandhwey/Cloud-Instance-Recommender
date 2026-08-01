# Tests

Plain-Node test harness — no framework, no npm install.

```bash
node tests/run-all.js       # all suites + golden byte-compare
node tests/syntax-check.js  # node --check over first-party JS
npm run coverage:check      # behavioral surface must be covered or waived
node tests/suites/ingest/column-mapping-test.js   # a single suite
```

## Layout

Suites are grouped by feature area, one folder deep — `run-all.js` and the
coverage ledger both recurse, so a suite is found wherever it sits:

| Folder                 | What it covers                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `suites/ingest/`       | file upload, CSV/xlsx parsing, sheet & column mapping, paste, input hygiene            |
| `suites/engine/`       | core sizing — fit, families, generations, nearest-miss, the worker protocol & watchdog |
| `suites/workload/`     | workload-class rules (burstable, GPU, SQL) and app→workload grouping                   |
| `suites/preview/`      | the results preview table — filters, visibility, pagination, search, staleness         |
| `suites/export/`       | downloads — CSV, xlsx, report, scenario compare, portfolio, no-match export            |
| `suites/manual-entry/` | the manual VM entry form and its bulk edit                                             |
| `suites/ui/`           | theme, accessibility, charts, presets, region validation, samples, ranges              |
| `suites/infra/`        | lazy region loading, monolith fallback, page parity, PWA, vendor integrity             |

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
  the output against `golden/goldens/*.csv`.

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
