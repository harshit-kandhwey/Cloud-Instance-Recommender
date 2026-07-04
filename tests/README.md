# Tests

Plain-Node test harness — no framework, no npm install.

```bash
node tests/run-all.js       # all suites + golden byte-compare
node tests/syntax-check.js  # node --check over first-party JS
node tests/suites/step4-test.js   # a single suite
```

## How it works

- **`suites/*.js`** — each suite builds a small simulated-DOM sandbox
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
