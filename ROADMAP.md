# Roadmap

Planned improvements for Cloud Instance Recommender, organized by release. This
is a living document — items are candidates, not commitments, and priorities
shift as the tool evolves. For what has already shipped, see
[CHANGELOG.md](CHANGELOG.md).

## How this roadmap is versioned

The project follows [Semantic Versioning](https://semver.org). This roadmap
plans **feature releases only**:

- **Minor releases** (`3.6`, `3.7`, …) group related features under a theme.
- The **next major** (`4.0`) collects the platform-defining changes — the ones
  that alter what the tool fundamentally does or how it is built.
- **Patches** — individual fixes, small tweaks, and review rounds — are not
  scheduled here; they land continuously between releases and are recorded in
  the [changelog](CHANGELOG.md).

Effort is a rough t-shirt size: **S** (hours), **M** (a few days), **L** (a
week or more). Dependencies are called out where one item needs another first.

## Engineering practices (continuous)

Not tied to any release — adopted once, then maintained every cycle:

- **Formatting gate in CI** — run `prettier --check` on every push and pull
  request, failing the build on anything unformatted. Auto-formatting and
  committing the fix from CI was considered and rejected: a bot commit would
  land without a changelog row or a version tag, putting holes in the
  per-commit version map. `npm run format` fixes it locally instead. (S)
- **Dependency-CVE watch** — monthly, and before each release, check the
  vendored SheetJS builds under `js/vendor/` for advisories, treating the
  versions embedded in those artifacts as the source of truth (today `xlsx.full`
  0.20.3 and `xlsx-js-style` 0.18.5); refresh `SECURITY.md`, and keep an
  explicit "nothing leaves your browser" privacy statement current on the
  landing page. (S)
- **Release hygiene** — keep [RELEASING.md](RELEASING.md) current: it is the
  release process (versioning, changelog, tagging, the pre-publish checklist)
  and it points at the service-worker cache rules in
  [CONTRIBUTING.md](CONTRIBUTING.md). (S)
- **Planning in the open** — track the adopted backlog on a public GitHub
  Project board and keep the issue templates current. (S)

## Minor releases

### 3.7 — Ingestion & input quality

Meet users where their inventory actually comes from, and catch bad input early.

- Import presets for the formats target users already have. **RVTools** and
  **AWS Application Discovery Service** are done — both built against real
  exports, which is the only way they could have been: RVTools writes its memory
  with a thousands separator, and ADS reports memory used in megabytes rather
  than as the percentage the optimizer needs. Neither fact is discoverable from
  documentation. **Azure Migrate is not done and is not scheduled**: it needs a
  real export, and we have no subscription to produce one. A mapping table
  written from memory would mis-map silently, which is worse than falling back to
  the mapping panel — the panel already handles these files correctly, and 3.7
  remembers the answer. Reopen this the day someone can supply a genuine Azure
  Migrate export. (M)

### 3.8 — Results, visualization & reporting

Turn the results grid into something you can explore and present.

- Full results table beyond the 20-row preview — pagination or virtualization,
  column show/hide, per-column filters, and a "no-match only" toggle. (M)
- Hand-built charts (no libraries — the project's choice, not a restriction:
  `script-src 'self'` permits same-origin scripts, so a vendored charting
  library would load just as SheetJS does, and `connect-src 'none'` blocks
  network connections rather than script execution; staying dependency-free
  keeps the CSP tight with no CDN and no supply-chain surface): a
  match-rate **meter**, family distribution, and vCPU/RAM before→after. Two
  deliberate departures from the original sketch: the match rate is a meter and
  **not a donut**, because a two-slice pie asks the eye to compare angles for
  something one length states exactly; and before→after is **two charts, not one**
  — vCPU and GiB are different scales, and a dual-axis chart implies a crossover
  wherever the two axes happen to be zeroed. Colours are theme tokens whose steps
  are chosen per mode against that mode's surface and contrast-checked, never
  flipped automatically. (M)
- Top-3 alternatives per row — the engine already ranks candidates internally. (M)
- Fit / headroom indicator per recommendation, flagging over-provisioned
  matches. (M)
- Scenario comparison v2 — named scenarios and N-way compare. **Shipped in 3.8**
  (3.8.11); the "saved across sessions" half is deferred to 3.10 and listed with
  the Storage manager below, since it needs the runtime quota detection that item
  adds. (M)
- Export a scenario's changed rows and its configuration diff as CSV. (S)
- App Portfolio: in-dashboard filters, cross-app search, and per-app CSV, plus
  the deferred cosmetic pass. (M)
- Executive print report — a print-optimized page ("Save as PDF" in the
  browser) with charts and a per-application rollup. (L) _Needs the charts
  above._

### 3.9 — Recommendation intelligence

Deeper, more accurate right-sizing.

- **Metadata enrichment** — network class and a SAP-certified flag. (M)
  _Blocked on external data:_ neither is in the region files and neither can be
  derived from them, so this needs a vetted third-party source. **Its original
  scope was wrong** — it also claimed ARM detection and GPU flags and said it
  "unlocks the items below". Both are already present: `isGraviton` / `isARM` /
  `processorArchitecture` cover ARM (and `rule-engine.js` already detects Ampere
  and T2A), and `familyName` already classifies accelerators — "GPU instance"
  (AWS), "GPU" (Azure), "Accelerator optimized" (GCP), plus ML ASIC / FPGA /
  Media Accelerator on AWS. What is genuinely missing is GPU _detail_ (model,
  count, VRAM), which only matters for a per-GPU-model rule.
- ~~GPU workload support.~~ **Done (3.9.4)** — `ML/AI` (or a CSV row that says
  `GPU`) now requires an accelerator, and every other workload excludes one, so
  a GPU box is never recommended by accident. Classification reads `familyName`
  rather than family prefixes, which do not survive crossing providers: the old
  prefix list called Azure's G/GS and Dl-series accelerators (60 instances in
  `eastus`) and let GCP's a2/a3 through. Per-GPU-model rules (count, VRAM)
  remain blocked on the missing GPU detail noted above.
- Storage-aware pass-through — carry disk GB/IOPS columns into the outputs and
  the currently-blank storage fields of the AWS bulk template. (M)
- ~~Percentile utilization — p95/peak columns alongside the average.~~ **Done
  (3.9.3.)** Three statistics (Average / p95 / Peak) with per-row fallback and a
  `Sized On` column recording the basis actually used.
- Burstable-preference rule for Dev/Test at low utilization (the inverse of the
  production exclusion). (M)
- SQL Server workload rule enforcing minimum core counts. (S)
- Multicloud family-equivalence explainers (for example, m5 ≈ Dsv5 ≈
  n2-standard). (M)

### 3.10 — Accessibility, hardening & documentation

Broaden reach and shore up quality.

- Mobile / responsive audit — the PWA is installable, so phones are real users
  now. (M)
- **Replace the unpatched styling engine.** `js/vendor/xlsx-js-style` is a fork
  of SheetJS 0.18.x and sits below the fixes for **CVE-2023-30533** (prototype
  pollution) and **CVE-2024-22363** (ReDoS). Both are read-path issues, and the
  fork is safe here **only because it never parses input** — v3.8.23 pinned reads
  to the patched full build (`window._xlsxParser`) and writes to the styling
  engine (`window._xlsxWriter`), enforced by `xlsx-engine-isolation-test.js`.
  Upstream is dormant, so that containment is the whole mitigation: any change
  that hands the fork a file to read reintroduces both CVEs. Assessment of record
  is in [SECURITY.md](SECURITY.md). (M)

  Two ways out, and the choice is the first task:
  - **Adopt a maintained styled-write path** — keeps the formatted workbooks.
  - **Drop styling and write with the patched full build** — removes the second
    engine entirely, and with it the whole class of collision. Cheapest and
    safest; costs cell formatting in the Excel exports.

  **Dependent work, all of which this item moves:**
  - `js/base/xlsx-export.js` and `js/base/portfolio.js` — the two styled writers,
    and the `{ styled }` flag they branch on.
  - `xlsx-engine-isolation-test.js` — its subject changes or disappears; if the
    second engine goes, retire the suite rather than leave a guard asserting a
    collision that can no longer happen.
  - `SECURITY.md` — the vendored-bundle table, the SHA-256 checksums, and the
    assessment of record; `vendor-integrity-test.js` fails until the checksums
    are updated in the same commit as the file.
  - `sw.js` `PRECACHE`/`CACHE` — a removed or renamed vendor bundle is a deleted
    file, which 404s on revalidation, so this needs a `CACHE` bump.
  - `CONTRIBUTING.md` — the "which engine may parse" rule below.

- Dedicated security regression suite: CSV-cell XSS into the preview and
  portfolio, formula-injection round-trip, prototype pollution (extending the
  recent fix), and localStorage tampering. **Should absorb the engine-isolation
  guard** so one suite owns "untrusted input never reaches an unpatched parser",
  whichever engines are vendored at the time. (M) _Pairs with the item above._
- **Scenarios saved across sessions** (deferred from 3.8) — pinned scenarios are
  session-only today. Persisting them means storing whole result sets, which is
  what makes this a storage problem rather than a scenario one: it needs the
  quota measurement and pressure handling the storage manager below adds, or it
  will fail silently on a large inventory. (M) _Needs the storage manager._
- Storage manager — view and clear all app localStorage, with runtime quota
  detection and quota-pressure handling. Browser localStorage limits vary by
  browser, origin, and mode; the portfolio copy alone has been observed near
  ~4 MB, close to the commonly seen ~5 MB ceiling, so the manager should measure
  actual usage rather than assume a fixed budget. Doubles as a privacy
  feature. (M)
- `docs/ARCHITECTURE.md` — module map, data flow, worker protocol, storage
  keys. (M)
- Screenshots and short GIFs in the README and user guide (text-only today). (M)
- Troubleshooting section (worker unavailable, `file://`, blocked popups,
  storage full). (S)
- SEO / OpenGraph tags and a Lighthouse ≥ 95 target. (S)

### 3.11 — Input authoring & rule expression

Make a correct input file easy to produce, and make the rules say what they mean.

- **Validated Excel template** — a downloadable `.xlsx` with data-validation
  dropdowns on the closed-enum columns: `ENV`, `OS`, `Workload`, `Compliance`,
  `Min Gen`, and — the highest-value one — `Region`, whose keys we already hold in
  the provider manifests. These are the columns where a typo is _silent_ today:
  `WebServer` instead of `Web Server` fires no workload rule, raises nothing, and
  produces a recommendation that looks entirely normal. Generated by a
  `tools/make-template.js` script and committed as an artifact, the way
  `tools/split-data.js` already generates the region files — a hand-authored
  binary drifts, and a binary is the one thing nobody sees drift. A guard suite
  opens the committed workbook and fails if its headers do not match the
  documented column set, if it does not load through the real pipeline with
  nothing to map, or if any dropdown offers a value the engine does not
  recognise. A dropdown offering a value the engine ignores is worse than free
  text, because the user has every reason to trust it. (M) _Needs the per-row
  allow-list below before it can offer a dropdown for it._
- **Multi-value cells without macros.** Excel data validation is single-select;
  accumulating comma-separated picks in one cell requires VBA, which means an
  `.xlsm`. That is **rejected, not deferred**: macro-enabled workbooks downloaded
  from a website trip security policy and trust prompts, do not work in Excel
  Online or Google Sheets, and undercut the "nothing leaves your browser" premise
  the tool rests on. The macro-free equivalent is helper columns — `Exclude 1..4`,
  each a dropdown — joined into the real `Exclude` cell with `TEXTJOIN`, which
  reaches the parser as the comma-separated string it already reads. (S) _Part of
  the template above._
- **Per-row allow-list** — an `Include Only` column, the symmetric twin of the
  existing per-row `Exclude`. The engine already supports allow-lists at the _run_
  level (`restrictInstanceFamilyNames`, `restrictMainFamilies`,
  `restrictProcessorManufacturers`); what it cannot express is "this VM may only
  land on these families", which is how licensing and platform-standard
  constraints actually arrive. Ship the engine support and the column together — a
  template column the engine does not read is a silent no-op the user has every
  reason to trust. (M)
- **Unknown rule values must be reported, not ignored.** Today an unrecognised
  `Workload`, `ENV`, `OS` or `Compliance` value simply matches no rule: no error,
  no warning, and a normal-looking recommendation computed without the constraint
  the user believed they had applied. The input check should name them the way it
  already names bad CPU and memory cells. This is the safety net for everyone who
  does not use the template, and it is worth more than the template. (S)
- **Row-level and run-level rule precedence** — when a per-row `Exclude` or
  `Include Only` disagrees with a run-level filter, the outcome today is whatever
  the filter order happens to produce. Decide it, document it, and pin it with a
  test. (S)
- **Rule-fired transparency** — `Rules Applied` reports which rules fired; extend
  it to say which candidates a rule _removed_, so a surprising recommendation can
  be explained without reading the engine. (M) _Feeds the user-defined rules UI in
  4.0._

### 3.12 — Test suite: structure and coverage

The suites are the reason the defects in this project get caught at all — and
they are also where several of them hid. Their weaknesses are known and specific.

- **One suite per unit, named for what it tests.** Suites are currently organised
  by the step of the plan that produced them (`step6`, `step8`, `step9`), so the
  name says when it was written, not what it covers — and the banned-dialog guard,
  the theme-token guard and the page-parity guard all live in files whose names
  reveal none of that. Rename by subject, and give each module's behaviour a home
  a reader can find from the filename alone. (M)
- **Coverage per function _and_ per feature.** Every exported function gets a
  suite that pins its behaviour, so a regression fails a named check rather than
  surfacing three modules downstream — or, as has happened here, not at all. And
  every user-visible feature gets one that exercises it end to end, because a
  feature can be broken while every function it is built from still passes: the
  units were fine when a page's sample preview drifted from the file it previews,
  when a panel was commented out of a page, and when the mapping panel offered two
  choices that were secretly the same column. Both layers, not one. (L)
- **Exhaustive cases, not happy paths.** General, edge, corner and — the ones most
  often missing — **negative** cases: the malformed file, the empty sheet, the
  header that repeats, the value that is absent rather than zero, the unit that is
  a lie, the row that cannot size. Nearly every defect this project has shipped
  lived in one of those and not in the happy path. (L)
- **A coverage inventory, and a gate that enforces it.** Exhaustive is a claim,
  and a claim needs a ledger. Enumerate every exported function, every page, every
  documented column and input format, and every user-visible feature, and record
  each as covered, not yet covered, or deliberately not covered _with the reason_.
  CI fails on an export that no suite names. The point is not the paperwork: it is
  that **nothing is ever skipped by accident — only by a decision someone wrote
  down.** Every silent defect in this project's history got in through a gap
  nobody knew was there. (M)
- **Smoke and functional tiers.** A fast smoke pass over each page's critical
  path (load → ingest → generate → export), separable from the exhaustive suites,
  so the quick check stays quick and the thorough one stays thorough. (M)
- **A guard must be proven to fail.** Plant the defect, watch it go red, remove
  the plant — every guard, no exceptions. Guards that never looked at the thing
  they claimed to check are the single largest bug class in this repo's history:
  a header matcher that caught 1 of 3 planted bugs, an `alert()` ban blind to
  `confirm()`, a comment stripper that passed a file _because_ it contained a URL,
  a panel check satisfied by a commented-out panel. Each was found by planting;
  none was found by reading. (S, continuous)
- **Golden-test expansion** — Azure-only, GCP-only and nearest-miss goldens, plus
  a structural compare for xlsx. (M) _Moved here from 3.10, where it sat alone._

### 3.13 — Closing out 3.x

The last minor before the major. Its only content is **every open item under
[Known issues](#known-issues-patch-level)** — 4.0 is gated on this list being
empty.

A major version should arrive because a line of development _finished_, not
because a defective one needed escaping. Shipping 4.0 over known defects would
say the opposite: that the new path was reached for instead of the old one being
completed. So nothing carries across. Anything found between now and then is
either fixed as a patch when it lands, or it belongs here.

- **The unreachable instance-family-name filter.**
  `restrictInstanceFamilyNames` is read by the engine, the option gatherer, the
  presets and the scenario diff, but no page renders its checkbox — so the filter
  can never be switched on, and its nearest-miss probe can never fire. Either give
  it the UI the rest of the code already expects, or remove it from all of them.
  (S) _The allow-list work in 3.11 is the natural home for the first option._

## Next major

### 4.0 — Platform expansion

Changes that redefine what the tool does or how it is built. **Gated on 3.13:**
no known issue crosses this line.

- **Cloud-to-cloud mode** — derive a VM's specs from its current instance type
  using our own data, instead of requiring CPU and memory columns, and right-size
  across providers. The biggest missing use case. (L) _The `Current Instance
Type` column landed in 3.7 and is carried through to the outputs; what remains
  is deriving specs FROM it._
- **GCP custom machine types** — recommend custom vCPU/RAM shapes when standard
  sizes waste resources. (L)
- **User-defined rules UI** — "if ENV = X, exclude family Y", stored and
  exported like presets. (L)
- **Strict CSP migration** — replace the generated HTML's inline
  `onclick`/`oninput` handlers with delegated listeners, then drop
  `script-src 'unsafe-inline'` (and evaluate the same for styles). The single
  biggest remaining hardening step. (L)

## Known issues (patch-level)

Tracked and fixed continuously rather than scheduled into a release — but this
list is also the whole content of [3.13](#313--closing-out-3x), and **4.0 does
not ship while anything is on it**. A known defect carried into a major release
says the new path was reached for instead of the old one being finished.

- The **instance-family-name filter is unreachable**. `restrictInstanceFamilyNames`
  is read by the engine, the option gatherer, the presets, and the scenario diff,
  but no page renders its checkbox — so the filter can never be switched on, and
  its nearest-miss probe can never fire. Either give it the UI the rest of the
  code already expects, or remove it from all of them. _Scheduled in 3.12; the
  allow-list work in 3.11 is the natural home for the first option._

## Suggesting an item

Ideas are welcome — open an issue or a discussion (see
[CONTRIBUTING.md](CONTRIBUTING.md)). Concrete, self-contained proposals are the
easiest to pick up.
