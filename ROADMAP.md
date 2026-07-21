# Roadmap

Planned improvements for Cloud Instance Recommender, organized by release. This
is a living document — items are candidates, not commitments, and priorities
shift as the tool evolves. For what has already shipped, see
[CHANGELOG.md](CHANGELOG.md).

## How this roadmap is versioned

The project follows [Semantic Versioning](https://semver.org). This roadmap
plans **feature releases only**:

- **Minor releases** (`3.10`, `3.11`, …) group related features under a theme.
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

### 3.9 — Recommendation intelligence (in progress)

Deeper, more accurate right-sizing. The shipped work — GPU workload support,
storage pass-through, percentile utilization, the burstable-preference rule, the
SQL Server licence floor, and the review-round fixes — is recorded in the
[changelog](CHANGELOG.md). What remains open:

- **Multicloud family-equivalence explainers** (for example, m5 ≈ Dsv5 ≈
  n2-standard). Designed once and reverted; still to land. (M)

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

### 3.13 — Data & pricing freshness

Keep the region datasets and the pricing the engine ranks on current —
automatically, and without the served page ever calling out.

- **Automated data refresh (build-time, CI).** A GitHub Actions job runs the
  `tools/split-data.js` pipeline on a schedule, refreshing the per-region
  instance files so a new family or a retired size does not wait for a hand-run.
  It all happens at build time — `connect-src 'none'` means the page itself never
  fetches anything. **Dependency:** the third-party source the region files are
  built from must be vetted first (its links and values verified by hand once),
  which is why this was deferred rather than shipped with the original split. (M)
- **Build-time pricing refresh.** The same job refreshes the pricing the engine
  ranks on, from each provider's public catalogue — **AWS** Price List Bulk API,
  **Azure** Retail Prices API, **GCP** Cloud Billing Catalog API. All three are
  free to read; the only real cost is repo and history growth, so the job bakes
  in **only the instance types × regions the app already ships**, never the whole
  catalogue. **Pricing stays internal, for ranking only** — the "no pricing in
  outputs" rule is unchanged; this is freshness, not a number on a report. The
  GCP catalogue's API key lives in CI secrets. (L) _Feeds 4.0's relative
  Optimization Impact, which needs current prices to rank well even though it
  never prints them._

### 3.14 — Closing out 3.x

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

## Blocked — awaiting external input

Not scheduled to a release because they cannot proceed on anything in this repo.
Each reopens the day its external dependency arrives.

- **Azure Migrate import preset** — needs a real Azure Migrate export to build
  against, and there is no subscription to produce one. A mapping table written
  from memory would mis-map silently, which is worse than the mapping panel — the
  panel already handles these files correctly and remembers the answer. Reopen
  the day someone can supply a genuine export. (M)
- **Metadata enrichment** — a network class and a SAP-certified flag are in none
  of the region files and cannot be derived from them, so both need a vetted
  third-party source. (ARM and accelerator detection, once bundled under this
  heading, already exist: `isGraviton` / `isARM` / `processorArchitecture` and
  the `familyName` accelerator classification. What is genuinely missing is GPU
  _detail_ — model, count, VRAM — which only a per-GPU-model rule would use.) (M)

## Next major

### 4.0 — Platform expansion

Changes that redefine what the tool does or how it is built. **Gated on 3.14:**
no known issue crosses this line.

- **Performance-based right-sizing engine** — the flagship. Today's Optimization
  pass sizes on one statistic chosen for the whole run; 3.9.3 gave that statistic
  three values (Average / p95 / Peak) with per-row fallback and a `Sized On`
  column, and 3.9.9 made CPU and memory resolve independently. This turns it into
  a **policy-driven** engine that chooses the sizing statistic **per row** from
  the workload's risk profile, and combines statistics for a safety check rather
  than trusting one. (L) _Builds directly on the 3.9.3 / 3.9.9 resolver; stores
  its policy the way presets and the [4.0 user-defined rules UI](#40--platform-expansion)
  do._

  **Optimization gains two sub-strategies:**

  - **Explicit metric** — the user names the statistic (Average, p90, p95, p99,
    Peak) and every row sizes on it, falling back only where a row lacks it. The
    3.9.3 behaviour, generalised past the three built-in statistics.
  - **Performance-based** — the statistic is chosen per row from a combination of
    **ENV × a new `Criticality` column × Workload**, with **ENV as the dominant,
    capping axis**: within an ENV, Criticality and Workload push toward that
    ENV's ceiling but never past it, so a Dev database is sized down to p90/p85
    even though a Prod database takes p95. Partner-standard defaults — Prod +
    Critical → p99, Prod + High → p95, Prod + Low → p90; Dev / Test / QA →
    Average; Database → p95/p99; Batch → Peak — **configurable per scenario** and
    shipping so nobody has to define anything.

  **The statistics are optional and file-only.** The percentile columns
  (`CPU p95`, `Memory p99`, `Peak CPU`, …) are detected and mapped from the
  upload through the column-mapping panel that already exists — there is **no
  form for them**. The users who have this data are enterprises exporting
  thousands of VMs from a monitoring platform, not someone typing a row; a normal
  upload carrying only an average still works and sizes on the average. The engine
  uses whatever the file carries and degrades per dimension (p95 → Peak → Average,
  recorded in `Sized On`). This is the honest boundary of "parameter-driven": a
  new percentile _column_ needs no code, a new sizing _rule_ does.

  **Multi-metric safety, not single-metric trust.** The failure mode of
  aggressive right-sizing is a downsize off a number that hid the busy periods, so
  the primary metric sizes and a **second metric vetoes**: size on p95, but if
  Peak CPU or Peak Memory exceeds ~95%, **flag the row for manual review rather
  than auto-downsizing it**. A one-off two-minute spike must not add an instance
  size, and a downsize must never fire against a VM that is regularly saturated
  (p95 > ~85%). The primary thresholds (avg < ~25%, p95 < ~50% → downsize
  candidate; p95 > ~85% → hold; peak > ~95% → review) are documented defaults and
  part of the configurable policy — they carry the _"never a plausible wrong
  answer"_ rule into the sizing math.

  **CPU and memory carry different defaults.** CPU is bursty and memory usually is
  not, so the default policy sizes CPU on p95 / Peak and memory on p95 / Maximum.
  The per-dimension resolver from 3.9.9 already sizes and reports the two axes
  independently, which is exactly the mechanism this needs.

- **Confidence and scale-out advisory** — richer utilization data supports more
  than a number. Both additions gate on the engine above _and_ on the data
  actually present:

  - **Confidence, two-tier.** Per-row confidence reflects the richness of _that
    row's_ data — how many statistics it carried, whether the sizing metric was
    the policy one or a fallback (`Sized On` already records this), and the spread
    between percentiles. Portfolio confidence reflects _fleet size_ — a 5,000-VM
    estate's aggregate estimate is more robust than a 10-VM one. The two are kept
    separate so neither is gameable: ten thousand average-only rows raise neither.
    Reported **coarse with a reason** (High / Medium / Low + "sized on average
    only — bursts invisible"), never a false-precision percentage, and surfaced
    through the existing `reportInputHygiene` upload-time notice. (M)
  - **Scale-out vs scale-up advisory.** A workload idle for most of the window
    that spikes predictably is a horizontal-scaling candidate — a smaller base
    instance behind an ASG / load balancer — not a permanently larger box.
    Detecting it needs two points of the distribution (a low sustained percentile
    and a high peak), so it is naturally gated on that data being present. It
    surfaces as an **advisory on the Portfolio page and the app summary**, only
    on performance-based runs, framed as guidance with its reasoning ("low p50,
    high Peak") — **not** an action. The tool sizes instances; it does not
    configure an ASG, and that line has to stay explicit or the advice
    overpromises. (M) _Portfolio and summary already exist — a new advisory column
    and a rollup, no new page._

- **Not 4.0: predictive / ML sizing.** Two structural blockers. `connect-src
'none'` means no model can be called over the network, so anything predictive
  would run client-side against a vendored model; and, more fundamentally,
  prediction needs a **time series**, while the input is a single snapshot per VM.
  Per-VM history is a data-model change, not a sizing tweak. Revisit only if the
  input format ever grows a time dimension.

- **Cloud-to-cloud mode** — derive a VM's specs from its current instance type
  using our own data, instead of requiring CPU and memory columns, and right-size
  across providers. The biggest missing use case. (L) _The `Current Instance
Type` column landed in 3.7 and is carried through to the outputs; what remains
  is deriving specs FROM it._
- **Multi-sheet Excel input & validated template** — a guided `.xlsx` workbook
  shipped as a default sample alongside the CSV: an `Inventory` sheet for the VM
  rows, reference sheets holding the closed-enum lists (ENV, OS, Workload,
  Compliance, the new Criticality column, and the Region keys already in the
  provider manifests) that back data-validation dropdowns, and a read-me sheet.
  A typo in a closed-enum column becomes unselectable rather than the silent
  no-op it is today. The reader picks the data sheet by name and ignores the
  reference sheets; the workbook is generated by a `tools/make-template.js`
  script and committed as an artifact, the way the region files are, with a guard
  suite that fails if a dropdown offers a value the engine does not recognise —
  a dropdown the engine ignores is worse than free text, because the user trusts
  it. The 4.0 evolution of the 3.11 validated template: multi-sheet, and carrying
  the Criticality and percentile columns the performance engine adds. (M) _Open
  question: SheetJS Community's data-validation **write** support is limited, so
  authoring the dropdowns may need a second tool; reading the workbook is
  unaffected._
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
list is also the whole content of [3.14](#314--closing-out-3x), and **4.0 does
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
