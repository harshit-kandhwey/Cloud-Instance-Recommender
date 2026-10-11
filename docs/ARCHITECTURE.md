# Architecture

How the tool is put together: where code lives, what loads in what order, how the recommendation worker talks to the page, and every place the browser stores data. Read this before adding a module, a stored key, or a page. For the working conventions, see [CONTRIBUTING.md](../.github/CONTRIBUTING.md).

## Shape of the system

Cloud Instance Recommender is a static, client-side application. There is no server and no build step. Every script is a classic `<script>` sharing one global scope, and the Content Security Policy sets `connect-src 'none'`, so page code cannot call the network. Region and pricing data ship as static files and are injected as same-origin scripts.

Nothing a user uploads leaves the browser. The persisted data is preferences, manually entered VMs, saved mappings, rules, presets, sizing policies, fleet snapshots, and a copy of the last results for the App Portfolio page (removed after a day), all in the browser's own storage. Snapshots and that copy include the uploaded columns, not the original file. The Browser Storage section on every tool page shows what is stored and lets the user clear it.

## Module map

```
aws.html, azure.html, gcp.html, multicloud.html   the four tool pages (one renderer each)
src/
  shared/      app-core.js        state, mapping tables, readiness, region validation, actionAttrs (control markup)
               storage-keys.js    every localStorage key the app owns
               storage-manager.js measure, write and clear the app's own keys
               page-actions.js    delegated dispatch for controls (data-on-click / data-on-change), only for the names in its PAGE_ACTION_NAMES list, and the data-style applier
               theme-init.js      sets the light/dark theme before first paint and wires the theme toggle (all seven pages)
               provider-init.js   runs the page's provider toggle on load (the four tool pages)
  core/
    rules/     rule-engine.js     ENV / OS / Workload / Compliance rules (window.RuleEngine)
               sizing-policy.js   sizing policy: statistic per row from ENV, Criticality and Workload, with storage
               user-rules.js      user-defined rule model, evaluator and storage
    engine/    generate.js        builds a run and calls the batch runner
               recommendation-worker.js  runs a batch off the main thread
               base-instance-selector.js, instance-selector-factory.js, provider selectors
  providers/   aws/ azure/ gcp/   data files and provider-specific selectors
  features/    ingest.js, manual-entry.js, presets.js, portfolio.js, downloads.js,
               preview.js, scenario-compare.js, fleet-snapshots.js, xlsx-export.js
  ui/          ui-shell.js, form-controls.js, charts.js, user-rules-ui.js,
               storage-manager-ui.js (the Browser Storage section),
               multicloud-page.js (multicloud.html only: the unified filter getters)
```

Provider-independent modules live under `src/` and are loaded by every tool page. Provider code lives under `src/providers/`. The page-parity test fails if the four pages load different provider-independent modules, or load them in a different order.

## Load order

Scripts run in the order the page lists them. Most are deferred; `src/shared/storage-keys.js`, `theme-init.js`, `provider-init.js` and `multicloud-page.js` are blocking head scripts, because they must run before the deferred modules (the theme before first paint, the keys before any module reads one, and the multicloud getters before the modules that would overwrite them). Two rules follow:

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
| `portfolioData` | `cloudInstanceRecommenderPortfolioData` | `app-core.js`, `downloads.js` | The portfolio copy of the last run; ignored and removed on read once its `generatedAt` is more than 24 hours old or unreadable (`portfolioCopyIsFresh`), or when the stored text is not valid JSON |
| `sections` | `cloudInstanceRecommenderSections` | `ui-shell.js` | Which sections are collapsed |
| `sizingPolicies` | `cloudInstanceRecommenderSizingPolicies` | `sizing-policy.js` | The sizing policy, keyed by page and versioned (below) |
| `stats` | `cloudInstanceRecommenderStats` | `downloads.js` | Local usage counts |
| `theme` | `cloudInstanceRecommenderTheme` | `theme-init.js` | The light or dark choice; absent means follow the OS |
| `userRules` | `cloudInstanceRecommenderUserRules` | `user-rules.js` | User-defined rules, keyed by page |

### Storage manager

`AppStorage` (`src/shared/storage-manager.js`) is the one path for reading the sizes of, writing, and clearing these keys:

- `usage()` returns each owned key's state and size, in UTF-16 bytes, and counts nothing outside the registry.
- `write(id, value)` returns `{ ok }` or `{ ok: false, reason }`. A browser quota error is `quota`; any other failure is `unavailable`. Neither throws, and an earlier value survives a refused write.
- `clear(id)` and `clearAll()` remove owned keys only.

The storage quota is set by the browser, typically about 5 MB per site. The app measures usage rather than assuming a budget.

### Fleet snapshot, schema version 1

`FleetSnapshots` (`src/features/fleet-snapshots.js`) stores one JSON array under the `fleetSnapshots` key. Each entry:

| Field | Type | Notes |
| --- | --- | --- |
| `v` | number | Always `1`. Entries with any other version are ignored on read, not migrated, and left untouched in storage by a save or delete. |
| `id` | string | Unique within the list. |
| `name` | string | Trimmed, 1 to 60 characters, unique within the list. |
| `takenAt` | string | ISO 8601 time the snapshot was built. |
| `providers` | string[] | Providers the run used. |
| `rules` | object[] | The user-defined rules the run applied. |
| `rows` | object[] | A copy of the run's per-VM results. |

Each result row carries the uploaded columns of its VM next to the recommendation, so a snapshot holds the inventory's data, though not the original file; an exported snapshot file holds the same rows. A snapshot never stores `priceSavings`. That value lives on the results array, not on a row, so copying rows cannot carry it.

Drift comparison (`FleetSnapshots.compareFleet`) treats two runs as the same estate only when their `VM Name` sets overlap by at least `MIN_OVERLAP` (90%) of the larger side, and both sides have unique, non-blank names. Anything else is refused, and the refusal names what was added and removed.

### Snapshot file (3.22)

`exportEntry` writes one stored snapshot as JSON (`format: "cir-fleet-snapshot"`, `v: 1`, name, `takenAt`, providers, rules, rows) and `importText` reads such a file back through the same `build` and `save` as a captured run, so the quota check and the two-tab guard apply. `parseImport` refuses, with a named reason and without storing anything: text over 4 MB, anything that is not JSON, a file of another format or version, more than 20,000 rows, a row holding anything but plain values, a key that would reach an object's prototype (`__proto__`, `constructor`, `prototype`), more than 8 providers or 500 rules, and a missing date or name. A name already in use is a refusal that carries a suggested rename; an import never replaces an existing snapshot.

## Sizing policy

`src/core/rules/sizing-policy.js` decides which utilization statistic a row is sized on (`avg`, `p90`, `p95`, `p99` or `peak`, ascending) from its ENV, Criticality and Workload. It is pure data plus a pure resolver (`resolvePolicyStatistic`). A run reads it only when **Size against** is set to `policy`: `generate.js` snapshots the stored policy into `options.sizingPolicy` (the worker cannot read storage), `recommendation-worker.js` imports the module, and `instance-selector-factory.js` validates the policy once per run and resolves each row's CPU and memory statistics from it. A policy that is not valid, or a missing module, stops that run with the problem named. Every other statistic leaves the policy unread. In a policy run `evaluateDownsizeVeto` (in the factory) checks, for each dimension the sizing pass would downsize, the row's own Peak and p95: Peak at or above `peakMin`, or p95 above `p95Max`, sets `holdCpuDownsize` or `holdMemoryDownsize` in the row's options (honoured by `getOptimizedInstance`, which then keeps that dimension's size) and records the reason in a `Review Flag` column that exists only on optimized policy runs. A missing reading never holds a downsize.

A policy is stored under the `sizingPolicies` key as one entry per tool page, each `{ v: 1, criticality, workload, envCeiling, memoryCeiling, veto }`. Criticality and Workload each name a statistic and the higher wins; the row's ENV class (`production`, `staging` or `dev`, read from `RuleEngine.RECOGNIZED.envClasses`) then caps it; memory is held at `memoryCeiling` or below. The policy also carries the safety veto's thresholds, `veto: { peakMin: 95, p95Max: 85 }` (percent, above 0 and at most 100). A blank or unrecognised ENV is capped like production and a blank Criticality counts as medium, because sizing on the higher figure is the safe error. Every value is checked against the engine's own vocabularies: an entry from another version is dropped for the defaults, and a bad cell keeps its default and is named in the problems the validator returns. A policy that fails validation is never saved.

## Validated input template

`assets/templates/cloud_instance_recommender_template.xlsx` is a ready-to-fill workbook (an `Inventory` sheet with example rows, an `Allowed values` sheet and a `Read me` sheet) whose ENV, OS, Workload and Criticality columns are dropdowns. It is a committed static file produced by `scripts/testing/make-template.js`, not built in the page: the vendored workbook writers cannot emit data validation, and a static file needs no library in the browser. Each tool page's "Download Excel Template" control is a plain `<a download>` link to it (so it works under `connect-src 'none'`), and `sw.js` precaches it so the link works offline. The app reads the `Inventory` sheet because sheets are scored by their columns and the reference sheets carry none of the required ones; `xlsx-ingest-test.js` pins that.

The script uses Node built-ins only. It writes the sheet XML, including the `dataValidations` rules, and a STORE-only zip with a fixed timestamp, so the same inputs always give the same bytes. It reads each dropdown's values from `RuleEngine.RECOGNIZED` (never a copy) and lists them on the `Allowed values` sheet, where each rule points at its range. Compliance is free text because it takes several comma-separated values.

`node scripts/testing/make-template.js` rewrites the file and `--check` fails if the committed file differs from what the script builds now. `tests/suites/export/validated-template-test.js` runs that comparison in the suite, so a change to the engine's vocabularies fails CI until the file is regenerated and committed. The same suite checks that each dropdown offers exactly the engine's values, that the package is well formed, and that the vendored reader opens it.

## Pricing and output

Prices rank recommendations internally. The only price figure shown is the relative per-provider saving (`results.priceSavings`), in the stats bar, the portfolio overview, and the executive print report, always with the data's freshness date. No dollar figure appears in any output, and no export carries a price column.

## Security boundaries

- The Content Security Policy is delivered in a `<meta>` placed before anything that loads a resource, so it governs every script on the page. A meta policy cannot carry `frame-ancestors`, and the static host sets no response headers, so the pages can be embedded in another site's frame; they hold no account and no state-changing action, but a hosting layer that can set headers should add `frame-ancestors 'none'`.
- The Content Security Policy allows scripts and styles only from the site itself. Pages carry no inline script, no inline style block and no style attributes; data-driven styles are set through the CSS object model (`data-style`), and controls dispatch through `data-on-*` attributes. `unsafe-inline` is not used for scripts or styles.
- Stored values are untrusted input. The stored-value loaders for presets, the app map, column mappings, user rules and sizing policies tolerate malformed and hostile values without throwing; `tests/suites/infra/storage-tamper-test.js` checks this.
- User text reaches the page only through `escapeHtml`, and never through an inline event handler. New UI uses data attributes and a delegated listener.
- Exports escape spreadsheet formula prefixes on every path, through one function (`guardFormula`).
- An upload is refused before it is parsed when it is over 10 MB, 100,000 rows or 500 columns, or is a workbook that declares more than 200 MB uncompressed; imported JSON (presets, rules, snapshot files) is size-capped and shape-checked before anything is stored.
- A control may invoke only a name in `PAGE_ACTION_NAMES`, and the spreadsheet parser is checked for identity and version (`xlsxParserIsSafe`) before it reads an upload.

## Tests and gates

`tests/README.md` describes the six CI jobs. The Node suites run under `tests/run-all.js` and drive the same module files the page loads. End-to-end specs under `tests/e2e/` run the shipped pages in a real browser.
