# Changelog

All notable changes to Cloud Instance Recommender, newest first. For planned
and potential work, see [ROADMAP.md](ROADMAP.md).

## Versioning & tags

The project follows **Semantic Versioning** (`MAJOR.MINOR.PATCH`):

- **MAJOR** — a platform-defining shift (1.x single→multi-cloud foundation,
  2.x rule engine and pricing removed from outputs, 3.x the modern app).
- **MINOR** — a feature release; the `### x.y` headings in the version map and
  the narrative release notes below correspond to these.
- **PATCH** — an individual commit within a release (a feature increment, fix,
  review round, docs, or formatting pass).

The **version map** below assigns every commit since the first a version and
describes what its change actually did. The 95 commits already published on
`main` keep their original commit messages unchanged; this table is the
reconciled, readable record on top of them. Versions are no longer printed in
the README, the user guide, or anywhere else in the product — they live here
and in git tags, so there is nothing to bump by hand.

**Tags.** Commits from `3.4.9` onward carry an annotated git tag of their
version (pushed to `origin`). The 95 earlier published commits are catalogued
here but not tagged. Going forward, each commit is tagged with its version when
it lands. A tagged commit's version is recoverable with `git describe --tags`;
the untagged historical commits are resolved through this version map.

The newest row uses `_this commit_` in place of a SHA because a commit cannot
contain its own hash; the next commit backfills it with the real short SHA, so
exactly one row (the current tip) ever carries the placeholder.

## Version map

### 3.5 — UI polish, preset export/import, offline banner, housekeeping (2026-07-10 → 2026-07-11)

| Version | Commit        | Date       | Change                                                                                                                                                                                                                                                                                                   |
| ------- | ------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.5.20  | _this commit_ | 2026-07-11 | Routed uploads by their content rather than their file extension: a workbook renamed `.csv` was read as text and parsed into garbage rows, and now reads correctly (with a note), while a legacy `.xls` or a non-spreadsheet file is refused with an explanation.                                        |
| 3.5.19  | c8c49f3       | 2026-07-11 | Gave every generated download a consistent, dated filename through one shared helper — the no-match, app-summary, and preset exports were undated — and switched the date stamp from UTC to the user's local day.                                                                                        |
| 3.5.18  | 827ea87       | 2026-07-11 | Added RELEASING.md, writing down the release process end to end: where versions live, how a commit is mapped and tagged, how a minor line is published, and what to check before publishing.                                                                                                             |
| 3.5.17  | 37b7878       | 2026-07-11 | Defined when a data refresh needs a service-worker cache bump (only when region files are removed, since a deleted file is served from cache forever) and made the split tool warn whenever it prunes one.                                                                                               |
| 3.5.16  | 6d4f81e       | 2026-07-11 | Documented the vendored libraries and a monthly, pre-release CVE-watch routine in the security policy, and added a "nothing leaves your browser" privacy statement to the landing page.                                                                                                                  |
| 3.5.15  | 6e2e55a       | 2026-07-11 | Added the CI formatting gate: every push and pull request is checked with Prettier and the build fails on anything unformatted, so formatting is fixed locally and never by an untagged bot commit.                                                                                                      |
| 3.5.14  | b75118d       | 2026-07-11 | Formatting changes by Prettier.                                                                                                                                                                                                                                                                          |
| 3.5.13  | 71b74ee       | 2026-07-11 | Pinned Prettier as a dev dependency and added a `.prettierignore` so the vendored SheetJS builds, the generated region data, and the golden fixtures are never reformatted.                                                                                                                              |
| 3.5.12  | c4a9b09       | 2026-07-11 | Removed the legacy upload pipeline, leaving a single ingest path: the duplicate file-input listener that raced the real one for the status, statistics, and preview panels is gone; drag-and-drop and the size/empty upload guards moved into that path; the unreachable integration hooks were deleted. |
| 3.5.11  | 13e5693       | 2026-07-11 | Addressed a docs review round: finalized the changelog SHAs and clarified roadmap wording on storage quota, the CI formatting gate, and the CVE-watch cadence.                                                                                                                                           |
| 3.5.10  | ecf9ef8       | 2026-07-11 | Populated the roadmap with the adopted backlog, grouped into themed minor releases and a 4.0 major.                                                                                                                                                                                                      |
| 3.5.9   | 303d3d0       | 2026-07-11 | Corrected the local-storage privacy note, extended nearest-miss guidance to auto-resolved regions, and tightened a preset comment and the probe-coupling test.                                                                                                                                           |
| 3.5.8   | 4f7ce4d       | 2026-07-11 | Restructured the changelog into a newest-first, per-commit version map, added a roadmap, and removed hardcoded versions from the product.                                                                                                                                                                |
| 3.5.7   | 9523d45       | 2026-07-10 | Hardened the review round: rejected reserved preset names, guarded the offline banner against a missing document body, and synced docs.                                                                                                                                                                  |
| 3.5.6   | 7255b95       | 2026-07-10 | Introduced this changelog, dropped the per-feature version tags from the README, and removed the unused PDF user guide.                                                                                                                                                                                  |
| 3.5.5   | 11d635f       | 2026-07-10 | Added an offline indicator banner to every page.                                                                                                                                                                                                                                                         |
| 3.5.4   | 22709c7       | 2026-07-10 | Added JSON export and import for filter presets.                                                                                                                                                                                                                                                         |
| 3.5.3   | 4bc5cf8       | 2026-07-10 | Replaced the native preset prompt and confirm dialogs with inline UI.                                                                                                                                                                                                                                    |
| 3.5.2   | 5a53cef       | 2026-07-10 | Added a configuration diff, a screen-reader live region, and a sticky header to scenario comparison.                                                                                                                                                                                                     |
| 3.5.1   | c598047       | 2026-07-10 | Grouped the download section into labeled clusters and fixed the results Excel button being destroyed on the AWS page.                                                                                                                                                                                   |
| 3.5.0   | 9e0a445       | 2026-07-10 | Added a coupling test tying every provider filter to a matching nearest-miss probe.                                                                                                                                                                                                                      |

### 3.4 — Presets, results Excel, nearest-miss, scenario compare, PWA (2026-07-05 → 2026-07-10)

| Version | Commit  | Date       | Change                                                                           |
| ------- | ------- | ---------- | -------------------------------------------------------------------------------- |
| 3.4.10  | d56f792 | 2026-07-10 | Reflowed the user guide with Prettier.                                           |
| 3.4.9   | 2a2ffef | 2026-07-10 | Documented the release's feature set across the README and user guide.           |
| 3.4.8   | f146bf8 | 2026-07-07 | Applied Prettier formatting.                                                     |
| 3.4.7   | cb35d2a | 2026-07-07 | Added PWA install and offline support.                                           |
| 3.4.6   | fc85f79 | 2026-07-06 | Addressed review: preset number round-trip, probe-coupling docs, portfolio a11y. |
| 3.4.5   | 478e350 | 2026-07-06 | Expanded test coverage for nearest-miss and scenario comparison.                 |
| 3.4.4   | 301051b | 2026-07-06 | Added scenario comparison for two generation runs.                               |
| 3.4.3   | fc259d1 | 2026-07-06 | Added a nearest-miss suggestion for filtered no-matches.                         |
| 3.4.2   | ef2b4ab | 2026-07-05 | Addressed review: multicloud preset filters, guards, and test coverage.          |
| 3.4.1   | a599348 | 2026-07-05 | Added a styled Excel export of the results grid.                                 |
| 3.4.0   | 37ef3b6 | 2026-07-05 | Added per-page filter presets and fixed App Portfolio row accessibility.         |

### 3.3 — App grouping, App Portfolio, test harness (2026-07-04 → 2026-07-05)

| Version | Commit  | Date       | Change                                                                                     |
| ------- | ------- | ---------- | ------------------------------------------------------------------------------------------ |
| 3.3.24  | 7aaf303 | 2026-07-05 | Made the App Portfolio dashboard keyboard- and screen-reader-accessible.                   |
| 3.3.23  | b81b332 | 2026-07-05 | Applied Prettier formatting.                                                               |
| 3.3.22  | dce0c59 | 2026-07-05 | Documented the App Portfolio across the README, contributing guide, and user guide.        |
| 3.3.21  | 204bb1e | 2026-07-05 | Hardened the portfolio Excel export: retry loader, all-row columns, and an Unassigned row. |
| 3.3.20  | cfadcf5 | 2026-07-05 | Added the App Portfolio executive Excel export.                                            |
| 3.3.19  | 0c7bf79 | 2026-07-05 | Applied Prettier formatting.                                                               |
| 3.3.18  | e844662 | 2026-07-05 | Addressed portfolio review: shared helpers, safe escaping, and navigation accessibility.   |
| 3.3.17  | 5dff811 | 2026-07-05 | Added the App Portfolio tabbed dashboard UI.                                               |
| 3.3.16  | e66e7ce | 2026-07-05 | Hardened the portfolio handoff and save-failure handling, and cleaned up tests.            |
| 3.3.15  | e291cb9 | 2026-07-05 | Added the App Portfolio analytics engine.                                                  |
| 3.3.14  | 0c725d6 | 2026-07-05 | Surfaced app-to-workload save failures instead of always reporting success.                |
| 3.3.13  | f7045e9 | 2026-07-05 | Added the App Portfolio page shell and result handoff.                                     |
| 3.3.12  | fcfbdc7 | 2026-07-04 | Hardened the app rollup and export, and consolidated the map-lookup guard.                 |
| 3.3.11  | 379de83 | 2026-07-04 | Applied Prettier formatting to LICENSE and tsconfig.                                       |
| 3.3.10  | 66fa4c1 | 2026-07-04 | Hardened App Name mapping.                                                                 |
| 3.3.9   | 35ef779 | 2026-07-04 | Added a per-app rollup and the App Summary export.                                         |
| 3.3.8   | ccd935f | 2026-07-04 | Added App Name grouping with app-to-workload inheritance.                                  |
| 3.3.7   | a242993 | 2026-07-04 | Dropped the unused WebWorker library from tsconfig.                                        |
| 3.3.6   | f4f49ec | 2026-07-04 | Fixed the Multicloud results-view layout and post-generation scroll.                       |
| 3.3.5   | 482dd9c | 2026-07-04 | Added opt-in JSDoc type checking, with no build step.                                      |
| 3.3.4   | a05627f | 2026-07-04 | Reported a union-based column count in the golden test log.                                |
| 3.3.3   | 7219261 | 2026-07-04 | Applied Prettier formatting to the split modules and NOTICE.                               |
| 3.3.2   | cd6934b | 2026-07-04 | Hardened the test harness.                                                                 |
| 3.3.1   | 974c716 | 2026-07-04 | Split the monolithic main script into eight feature modules.                               |
| 3.3.0   | f33a29e | 2026-07-04 | Added the in-repo test suite and CI workflow.                                              |

### 3.2 — Nine upgrades: lazy data, worker, mapping, Excel, dark mode (2026-07-03 → 2026-07-04)

| Version | Commit  | Date       | Change                                                                         |
| ------- | ------- | ---------- | ------------------------------------------------------------------------------ |
| 3.2.21  | 76181d5 | 2026-07-04 | Aligned the README license summary with the PolyForm grant.                    |
| 3.2.20  | dca5abd | 2026-07-04 | Scoped the column-mapping panel to the page's providers.                       |
| 3.2.19  | baa5839 | 2026-07-04 | Fixed units in the no-panel mapping fallback and deduplicated the MB check.    |
| 3.2.18  | 9e3eb8f | 2026-07-04 | Relicensed the project to PolyForm Noncommercial 1.0.0.¹                       |
| 3.2.17  | 3e2f4c5 | 2026-07-04 | Added manual VM entry, a mapping editor, and MB→GB memory conversion.          |
| 3.2.16  | aa80bab | 2026-07-04 | Applied Prettier formatting.                                                   |
| 3.2.15  | 689b55e | 2026-07-04 | Documented the release's feature set.                                          |
| 3.2.14  | ebfa58c | 2026-07-04 | Added an accessibility pass: keyboard operation, live regions, and skip links. |
| 3.2.13  | 532c13d | 2026-07-04 | Added dark mode via CSS custom properties.                                     |
| 3.2.12  | 3b7edb9 | 2026-07-04 | Refined the preview render options and file-format wording.                    |
| 3.2.11  | e59d672 | 2026-07-04 | Added the no-match remediation export.                                         |
| 3.2.10  | 8c3cdd5 | 2026-07-04 | Hardened the upload paths.                                                     |
| 3.2.9   | d7eb0f2 | 2026-07-03 | Added a search filter to the results preview.                                  |
| 3.2.8   | 4a44068 | 2026-07-03 | Added Excel (.xlsx) upload via vendored SheetJS.                               |
| 3.2.7   | 1fc6213 | 2026-07-03 | Introduced named constants for mappable and required columns.                  |
| 3.2.6   | a547a3d | 2026-07-03 | Made the split tool write new region files before pruning stale ones.          |
| 3.2.5   | 8d76ec0 | 2026-07-03 | Added a column-mapping UI with fuzzy header auto-match.                        |
| 3.2.4   | d4db9e2 | 2026-07-03 | Addressed review of region resolution, the worker, and the split tool.         |
| 3.2.3   | 32390c8 | 2026-07-03 | Moved recommendation batches into a Web Worker with a real progress bar.       |
| 3.2.2   | f992386 | 2026-07-03 | Added a region validation panel after CSV upload.                              |
| 3.2.1   | 9b7ec59 | 2026-07-03 | Split instance data into per-region files with lazy loading.                   |
| 3.2.0   | 12c1501 | 2026-07-03 | Added lazy region-loading infrastructure, backward compatible.                 |

¹ Grouped with the 3.3 release in the notes below, but committed during the
3.2 cycle, so it carries a 3.2.x version by commit order.

### 3.1 — Filter fixes and UX enhancements (2026-06-28)

| Version | Commit  | Date       | Change                                                                                                                                                                                                                                                                      |
| ------- | ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1.4   | 25feb0f | 2026-06-28 | Restructured the repository and removed dead code.                                                                                                                                                                                                                          |
| 3.1.3   | 62188f9 | 2026-06-28 | Fixed the Content Security Policy that was blocking inline onclick handlers.                                                                                                                                                                                                |
| 3.1.2   | da9143a | 2026-06-28 | Applied review follow-ups and refreshed the README.                                                                                                                                                                                                                         |
| 3.1.1   | 3c6602d | 2026-06-28 | Fixed the Azure and GCP series, family, and machine-type filters (which checked options that did not exist), added the missing processor filters with platform-name normalization, tightened fuzzy region resolution to single-prefix matches, and fixed a copy-button XSS. |
| 3.1.0   | 9a8195b | 2026-06-28 | Added ten UX and feature enhancements across the tool pages.                                                                                                                                                                                                                |

### 3.0 — Rule Engine UI (2026-06-27 → 2026-06-28)

| Version | Commit  | Date       | Change                                                                                             |
| ------- | ------- | ---------- | -------------------------------------------------------------------------------------------------- |
| 3.0.4   | 75f7210 | 2026-06-28 | Reformatted long lines in the file handler and fixed README whitespace.                            |
| 3.0.3   | 1eea5e9 | 2026-06-28 | Fixed burstable exclusion and security issues.                                                     |
| 3.0.2   | 6e7a884 | 2026-06-28 | Applied review fixes across the file handler, rule engine, multicloud, and docs.                   |
| 3.0.1   | 23f2069 | 2026-06-28 | Consolidated the release: rule engine, multicloud filter redesign, review fixes, and docs.         |
| 3.0.0   | 07576ad | 2026-06-27 | Added the Rule Engine UI controls, the Minimum Generation filter, and the AWS bulk-template split. |

### 2.0 — Rule engine core; pricing removed from outputs (2026-06-27)

| Version | Commit  | Date       | Change                                                                                                                                 |
| ------- | ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 2.0.6   | 5c386e7 | 2026-06-27 | Added AWS bulk-upload reference templates.                                                                                             |
| 2.0.5   | 5bcf4fa | 2026-06-27 | Retuned right-sizing: downsize threshold 50% → 40%, upsize unchanged at 80%.                                                           |
| 2.0.4   | 0298c3b | 2026-06-27 | Added the rule engine: ENV/OS/Workload/Compliance rules for burstable exclusion, size floors, OS compatibility, and family preference. |
| 2.0.3   | 4a7b5ea | 2026-06-27 | Removed pricing columns from the output CSV and added the AWS Pricing Calculator bulk-template download.                               |
| 2.0.2   | 2176020 | 2026-06-27 | Expanded Azure to 63 and GCP to 47 regions and added the GCP N4, C4, M4, G2, H3, and Z3 families.                                      |
| 2.0.1   | fcb5d61 | 2026-06-27 | Refreshed instance data for 35 AWS, 60 Azure, and 46 GCP regions with Windows pricing.                                                 |
| 2.0.0   | 2dc5af4 | 2026-06-27 | Added community standards: a security policy, code of conduct, contributing guide, and issue/PR templates.                             |

### 1.3 — User guide and public release (2025-06-20)

| Version | Commit  | Date       | Change                                                                    |
| ------- | ------- | ---------- | ------------------------------------------------------------------------- |
| 1.3.2   | 5dc5268 | 2025-06-20 | Fixed the landing-page user-guide launcher.                               |
| 1.3.1   | 09a09ff | 2025-06-20 | Added the landing-page user-guide entry and refreshed the landing styles. |
| 1.3.0   | 148e328 | 2025-06-20 | Shipped the first user guide.                                             |

### 1.2 — Advanced filtering, license, and publish (2025-06-19)

| Version | Commit  | Date       | Change                                                                          |
| ------- | ------- | ---------- | ------------------------------------------------------------------------------- |
| 1.2.4   | 2d90d62 | 2025-06-19 | Added the GitHub Pages link to the README.                                      |
| 1.2.3   | 01ecb52 | 2025-06-19 | Added the project LICENSE.                                                      |
| 1.2.2   | 01f7ea2 | 2025-06-19 | Rewrote the README into a full project overview.                                |
| 1.2.1   | 08f58f2 | 2025-06-19 | Expanded advanced filtering for Azure and GCP.                                  |
| 1.2.0   | 3f49188 | 2025-06-19 | Added GCP exclude-type controls and cost, performance, and sustainability tips. |

### 1.1 — Multi-cloud and modular architecture (2025-06-19)

| Version | Commit  | Date       | Change                                                                                                                                                  |
| ------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1.2   | 3482e95 | 2025-06-19 | Cleaned up the Azure module: removed duplicate functions and added missing ones.                                                                        |
| 1.1.1   | ae53409 | 2025-06-19 | Fixed the headings on the Azure, GCP, and Multicloud pages.                                                                                             |
| 1.1.0   | 048446f | 2025-06-19 | Restructured to multi-cloud with a modular architecture: added the Azure, GCP, and Multicloud pages and split the code into base and per-cloud modules. |

### 1.0 — Initial single-cloud recommender (2025-05-30 → 2025-06-07)

| Version | Commit  | Date       | Change                                                                                                    |
| ------- | ------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| 1.0.10  | 221d9fe | 2025-06-07 | Added instance data for 35 AWS regions.                                                                   |
| 1.0.9   | 78a2175 | 2025-06-06 | Removed the two file-handling modules replaced by the consolidated handler.                               |
| 1.0.8   | 8c6a4e9 | 2025-06-06 | Added styles for the usage-counter component.                                                             |
| 1.0.7   | 7814730 | 2025-06-06 | Refactored the main script to remove redundant code and resolve file-handling conflicts.                  |
| 1.0.6   | c4895f5 | 2025-06-06 | Pointed the app at the consolidated file handler and removed the obsolete scripts.                        |
| 1.0.5   | 738a6a3 | 2025-06-06 | Consolidated the two file handlers into a single module.                                                  |
| 1.0.4   | 0604239 | 2025-05-30 | Added an "in creation" notice to the landing page.                                                        |
| 1.0.3   | 97ee049 | 2025-05-30 | Shipped the first working recommender: CSV upload, the recommendation UI, and single-cloud file handling. |
| 1.0.2   | 82134cf | 2025-05-30 | Refined the README wording.                                                                               |
| 1.0.1   | e8f0f4b | 2025-05-30 | Expanded the README into a project overview.                                                              |
| 1.0.0   | ee9908e | 2025-05-30 | Created the repository.                                                                                   |

---

## Release notes

Newest first. Readable summaries of each feature release; per-commit detail is
in the version map above.

### 3.5 — 2026-07-10 → 2026-07-11

UI polish and housekeeping.

- **Download section grouping** — the post-generation buttons now sit in
  labeled clusters (Results / AWS Pricing Calculator / Analysis) instead of a
  flat button run; the Analysis cluster hides itself when empty. Also fixed the
  Results Excel button being destroyed on the AWS page after every generation.
- **Scenario comparison config diff** — comparing two pinned runs now shows a
  "Configuration changes (A → B)" table of every setting that differed
  (recommendation type, providers, filters, thresholds, rule defaults, and
  per-provider filter selections). Comparison outcomes are announced to screen
  readers via a polite live region, and the changed-rows table scrolls under a
  sticky header.
- **Preset inline dialogs** — saving a preset uses an inline name form and
  overwrite/update/delete use two-step confirm buttons, replacing the native
  `prompt()`/`confirm()` dialogs.
- **Preset export/import** — a page's presets can be downloaded as a JSON file
  and imported elsewhere; imports validate the file shape and merge without
  overwriting (name collisions get an " (imported)" suffix). Preset names that
  collide with `Object.prototype` (`__proto__`, `constructor`, `prototype`) are
  rejected on save and import.
- **Offline indicator** — every page shows a small banner while the connection
  is down and a short "Back online" notice on reconnect.
- **Nearest-miss probe coupling test** — a source-scan test now enforces that
  every filter option a provider's `applyFilters` reads has a matching
  nearest-miss probe, so the Nearest Miss column can't silently under-report.
- **Housekeeping** — project history moved to this changelog as a per-commit
  version map; a roadmap was added; hardcoded versions were removed from the
  README and user guide (versions now live only in the changelog and git tags);
  the unused `docs/user-guide.pdf` was removed; SemVer git tagging was adopted.

### 3.4 — 2026-07-05 → 2026-07-10

- **Filter presets** — save/apply/update/delete named filter configurations per
  tool page (localStorage).
- **Results Excel export** — the results grid as a styled single-sheet `.xlsx`
  (formatted header, autofilter, fitted widths, typed numeric columns), engine
  lazy-loaded on first click.
- **Nearest-miss diagnostics** — no-match rows get a per-provider "Nearest Miss"
  column naming the closest size-fitting instance and the filter group(s) that
  excluded it.
- **Scenario comparison** — pin two generation runs and diff them: summary KPIs
  (VMs changed, match rate A → B, newly matched/unmatched) plus a changed-rows
  table with old → new values.
- **PWA install + offline support** — web app manifest, icon, and a service
  worker precaching the app shell with stale-while-revalidate runtime caching;
  the tool works offline for pages and regions already visited.
- Documentation pass across the README, contributing guide, and user guide.

### 3.3 — 2026-07-04 → 2026-07-05

- **App grouping** — optional `App Name` column groups the estate by
  application, with an app → workload mapping panel whose assignments VMs
  inherit at generation.
- **App Summary CSV** — per-application rollup export (VM count, total
  vCPUs/memory, matched vs no-match).
- **App Portfolio page** — a dedicated dashboard (`app-portfolio.html`) fed by
  an in-browser handoff: overview tab with sortable app table, rankings, and
  data-hygiene callouts, plus one tab per app; fully keyboard- and
  screen-reader-accessible.
- **Executive Excel** — styled workbook with a Portfolio Summary, Contents
  sheet, one sheet per app (plus Unassigned), and an About sheet, via the
  vendored `xlsx-js-style` fork with a plain-SheetJS fallback.
- Under the hood: relicensed to PolyForm Noncommercial 1.0.0; added the in-repo
  plain-Node test harness with golden-output compare and CI; split the
  monolithic main script into eight feature modules; added opt-in JSDoc type
  checking (no build step).

### 3.2 — 2026-07-03 → 2026-07-04

Nine upgrades in one release:

- **Lazy per-region data loading** — instance data split into one file per
  region (141 files); pages load a tiny manifest and fetch only the regions the
  uploaded CSV references (initial download ~25 MB → a few KB).
- **Web Worker processing** — batches run off the main thread with a real
  progress bar and an automatic chunked main-thread fallback with identical
  output.
- **Region validation panel** — per-region chips after upload: recognized,
  auto-resolved (`us-east-1a → us-east-1`), or unknown.
- **Column auto-mapping** — exact/synonym/normalized header matching with a
  mapping panel for ambiguous cases, an Edit-mapping button, MB→GB memory
  conversion, and per-header-set persistence.
- **Excel upload** — `.xlsx` files parse in-browser via vendored SheetJS, loaded
  only when needed.
- **Manual VM entry** — form-based entry (with region autocomplete) feeding the
  same pipeline as uploads.
- **Results preview search** — live filter box over the preview table.
- **No-match remediation export** — export exactly the rows no provider matched,
  with reasons, to fix and re-upload.
- **Dark mode + accessibility pass** — theme tokens with a persistent toggle
  (follows the OS until overridden), keyboard operation end to end, live
  regions, skip links, and visible focus outlines.

### 3.1 — 2026-06-28

- Ten UX/feature enhancements across the tool pages.
- Fixed the Azure VM series / VM family and GCP machine series / category
  filters (previously checked options that didn't exist) and added the missing
  Azure/GCP processor filters with platform-name normalization.
- Safer fuzzy region resolution (single-prefix matches only) and an XSS fix in
  the preview copy button.
- Fixed CSP blocking inline onclick handlers; restructured the repository and
  removed dead code.

### 3.0 — 2026-06-27 → 2026-06-28

- **Rule Engine UI** — five dropdowns (ENV, OS, Workload incl. SAP, Compliance,
  Min Gen) set batch-wide defaults, with per-row CSV overrides and conflict
  detection that flags contradictory filter combinations.
- Multicloud filter redesign and a round of review fixes (burstable exclusion,
  file handler, security).

### 2.0 — 2026-06-27

- **Rule engine core** — ENV/OS/Workload/Compliance rules for burstable
  exclusion, size floors, OS compatibility, and workload-aware family
  preference.
- Removed pricing columns from the output CSV (price stays internal for ranking
  only) and added the AWS Pricing Calculator bulk-template export with reference
  templates.
- Refreshed instance data (AWS 35, Azure 63, GCP 47 regions; new GCP machine
  families) and updated right-sizing defaults (downsize threshold 50% → 40%).
- Added community standards: security policy, code of conduct, contributing
  guide, and issue/PR templates.

### 1.3 — 2025-06-20

- Shipped the first user guide and linked it from the landing page.

### 1.2 — 2025-06-19

- Added GCP exclude-type controls and cost/performance/sustainability tips, and
  expanded advanced per-provider filtering for Azure and GCP.
- Rewrote the README, added the LICENSE, and published on GitHub Pages.

### 1.1 — 2025-06-19

- Added the Azure, GCP, and Multi-Cloud pages.
- Split the codebase into base and per-cloud modules for maintainability.

### 1.0 — 2025-05-30 → 2025-06-07

- First working tool: CSV upload, like-to-like and utilization-based optimized
  sizing, and advanced per-provider filtering for a single cloud.
- Consolidated the file-handling layer and added the first AWS region data (35
  regions).
