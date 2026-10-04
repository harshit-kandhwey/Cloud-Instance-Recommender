# Architecture

How the tool is put together: where code lives, what loads in what order, how the recommendation worker talks to the page, and every place the browser stores data. Read this before adding a module, a stored key, or a page. For the working conventions, see [CONTRIBUTING.md](../.github/CONTRIBUTING.md).

## Shape of the system

Cloud Instance Recommender is a static, client-side application. There is no server and no build step. Every script is a classic `<script>` sharing one global scope, and the Content Security Policy sets `connect-src 'none'`, so page code cannot call the network. Region and pricing data ship as static files and are injected as same-origin scripts.

Nothing a user uploads leaves the browser. The only persisted data is preferences, manually entered VMs, saved mappings, rules, presets, and (since 3.21) fleet snapshots, all in the browser's own storage. The Browser Storage section on every tool page shows what is stored and lets the user clear it.

## Module map

```
aws.html, azure.html, gcp.html, multicloud.html   the four tool pages (one renderer each)
src/
  shared/      app-core.js        state, mapping tables, readiness, region validation, actionAttrs (control markup)
               storage-keys.js    every localStorage key the app owns
               storage-manager.js measure, write and clear the app's own keys
               page-actions.js    delegated dispatch for controls (data-on-click / data-on-change), and the data-style applier
  core/
    rules/     rule-engine.js     ENV / OS / Workload / Compliance rules (window.RuleEngine)
               user-rules.js      user-defined rule model, evaluator and storage
    engine/    generate.js        builds a run and calls the batch runner
               recommendation-worker.js  runs a batch off the main thread
               base-instance-selector.js, instance-selector-factory.js, provider selectors
  providers/   aws/ azure/ gcp/   data files and provider-specific selectors
  features/    ingest.js, manual-entry.js, presets.js, portfolio.js, downloads.js,
               preview.js, scenario-compare.js, fleet-snapshots.js, xlsx-export.js
  ui/          ui-shell.js, form-controls.js, charts.js, user-rules-ui.js,
               storage-manager-ui.js (the Browser Storage section)
```

Provider-independent modules live under `src/` and are loaded by every tool page. Provider code lives under `src/providers/`. The page-parity test fails if the four pages load different provider-independent modules, or load them in a different order.

## Load order

Scripts are deferred and run in the order the page lists them. Two rules follow:

- `src/shared/storage-keys.js` loads before any module that reads a key at top level. `user-rules.js`, `presets.js`, `app-core.js`, `ui-shell.js`, `downloads.js`, `ingest.js`, and `manual-entry.js` all read `STORAGE_KEYS` when they load.
- `src/shared/storage-manager.js` loads before the snapshot and storage-panel modules that call it. `fleet-snapshots.js` loads before `storage-manager-ui.js`.

`storage-keys-test` enforces the first rule on all four pages and in the worker.

## The recommendation worker

`src/core/engine/recommendation-worker.js` runs generation off the main thread. It imports the rule and selector modules with `importScripts`, so its list must match the dependencies of those modules: it loads `storage-keys.js` first, because `user-rules.js` reads the registry at load time.

Messages from the page:

| Message | Fields | Meaning |
| --- | --- | --- |
| `run` | `csvData`, `providers`, `options`, `regionData`, `flags` | Generate for these rows. `regionData` carries the region globals the main thread resolved. |

Messages back to the page:

| Message    | Fields          | Meaning                            |
| ---------- | --------------- | ---------------------------------- |
| `progress` | `done`, `total` | Rows processed so far.             |
| `result`   | `results`       | The completed rows.                |
| `error`    | `message`       | The run failed; the page shows it. |

Region data arrives by `postMessage` because the worker cannot fetch. A region the main thread did not send falls back to sample data, so the main thread must send everything it can resolve.

## Stored data

Every key the app owns is listed in `src/shared/storage-keys.js` and nowhere else. `storage-keys-test` fails if a key string appears outside that file.

| Registry id | Key | Owner | Holds |
| --- | --- | --- | --- |
| `appMap` | `cloudInstanceRecommenderAppMap` | `ingest.js` | Application to workload assignments |
| `columnMaps` | `cloudInstanceRecommenderColumnMaps` | `ingest.js` | Saved column mappings, versioned |
| `filterPresets` | `cloudInstanceRecommenderFilterPresets` | `presets.js` | Named filter presets |
| `fleetSnapshots` | `cloudInstanceRecommenderFleetSnapshots` | `fleet-snapshots.js` | Named snapshots of a run (below) |
| `manualVMs` | `cloudInstanceRecommenderManualVMs` | `manual-entry.js` | VMs entered by hand |
| `portfolioData` | `cloudInstanceRecommenderPortfolioData` | `app-core.js`, `downloads.js` | The portfolio copy of the last run |
| `sections` | `cloudInstanceRecommenderSections` | `ui-shell.js` | Which sections are collapsed |
| `stats` | `cloudInstanceRecommenderStats` | `downloads.js` | Local usage counts |
| `theme` | `cloudInstanceRecommenderTheme` | `theme-init.js` | The light or dark choice; absent means follow the OS |
| `userRules` | `cloudInstanceRecommenderUserRules` | `user-rules.js` | User-defined rules, keyed by page |

### Storage manager

`StorageManager` (`src/shared/storage-manager.js`) is the one path for reading the sizes of, writing, and clearing these keys:

- `usage()` returns each owned key's state and size, in UTF-16 bytes, and counts nothing outside the registry.
- `write(id, value)` returns `{ ok }` or `{ ok: false, reason }`. A browser quota error is `quota`; any other failure is `unavailable`. Neither throws, and an earlier value survives a refused write.
- `clear(id)` and `clearAll()` remove owned keys only.

The storage quota is set by the browser, typically about 5 MB per site. The app measures usage rather than assuming a budget.

### Fleet snapshot, schema version 1

`FleetSnapshots` (`src/features/fleet-snapshots.js`) stores one JSON array under the `fleetSnapshots` key. Each entry:

| Field | Type | Notes |
| --- | --- | --- |
| `v` | number | Always `1`. Entries with any other version are dropped on read, not migrated. |
| `id` | string | Unique within the list. |
| `name` | string | Trimmed, 1 to 60 characters, unique within the list. |
| `takenAt` | string | ISO 8601 time the snapshot was built. |
| `providers` | string[] | Providers the run used. |
| `rules` | object[] | The user-defined rules the run applied. |
| `rows` | object[] | A copy of the run's per-VM results. |

A snapshot never stores the raw inventory, and never stores `priceSavings`. That value lives on the results array, not on a row, so copying rows cannot carry it.

Drift comparison (`FleetSnapshots.compareFleet`) treats two runs as the same estate only when their `VM Name` sets overlap by at least `MIN_OVERLAP` (90%) of the larger side, and both sides have unique, non-blank names. Anything else is refused, and the refusal names what was added and removed.

## Pricing and output

Prices rank recommendations internally. The only price figure shown is the relative per-provider saving (`results.priceSavings`), in the stats bar, the portfolio overview, and the executive print report, always with the data's freshness date. No dollar figure appears in any output, and no export carries a price column.

## Security boundaries

- The Content Security Policy allows scripts and styles only from the site itself. Pages
  carry no inline script, no inline style block and no style attributes; data-driven
  styles are set through the CSS object model (`data-style`), and controls dispatch through
  `data-on-*` attributes. `unsafe-inline` is not used for scripts or styles.
- Stored values are untrusted input. The stored-value loaders for presets, the app map, column mappings and user rules tolerate malformed and hostile values without throwing; `tests/suites/infra/storage-tamper-test.js` checks this.
- User text reaches the page only through `escapeHtml`, and never through an inline event handler. New UI uses data attributes and a delegated listener.
- Exports escape spreadsheet formula prefixes on every path.

## Tests and gates

`tests/README.md` describes the six CI gates. The Node suites run under `tests/run-all.js` and drive the same module files the page loads. End-to-end specs under `tests/e2e/` run the shipped pages in a real browser.
