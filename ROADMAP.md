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

## Now / Next / Later

A priority view over the sections below. The order is deliberate: the test and
accessibility scaffolding comes **before** the feature-heavy minors, because
this project's dominant, documented failure mode is a silent defect that only a
test catches — so the safety net is built first and every later release lands on
top of it.

- **Shipped** — _3.10 Test foundation & CI gates_ · _3.11 Accessibility, hardening
  & docs_ · _3.12 Input authoring & rules_ · _3.13 Cross-provider sizing_ ·
  _3.14 Data & pricing freshness_. The safety net first — real-browser end-to-end
  coverage, an accessibility regression gate, property-based engine invariants and a
  mutation-testing gate that proves the guards actually catch defects — then the
  capability jumps that did not need the 4.0 engine: better inputs and rule
  expression, cloud-to-cloud sizing and GCP custom shapes, and data the pipeline
  keeps current on its own.
- **Now** — _3.15 Data model & catalogue fidelity_. Split the region format so
  specs stop repeating per region. It is sequenced first because it is what makes
  everything after it cheap: today each added field costs one copy per region
  rather than one per type, and the same regenerate closes the local-SSD pricing
  gap and the catalogue defects filed against it.
- **Next** — _3.16 Attribute filters & rule fidelity_ · _3.17 Closing out 3.x_.
  Spend what the split makes affordable: turn three of the engine's admitted
  proxies into the measurements the providers publish (a fourth, Windows support,
  was done early in 3.15 alongside the same root cause), offer the instance
  attributes the data already carries, widen the workload vocabulary the
  recommendations key off, then empty the known-issues list.
- **Later** — _4.0 Performance-based right-sizing_. The one platform-defining
  major: a policy-driven, per-row sizing engine. Further out, and deliberately
  unscheduled: [beyond compute](#later--beyond-compute).

**Success measures.** Targets, not yet commitments — set the exact numbers when
each item is scheduled:

- **Browser coverage** — Playwright end-to-end green on all four tool pages
  across at least two engines (Chromium + WebKit or Firefox) in CI, covering
  upload → map → validate → generate → export → offline.
- **Accessibility** — zero `axe` violations on each page's critical path, full
  keyboard operability of the mapping dialog / filters / tables / exports, and a
  Lighthouse accessibility score ≥ 95.
- **Initial load** — cold load and first-generate under an agreed budget on a
  mid-tier laptop, XLSX code not fetched until an `.xlsx` is actually chosen, and
  a Lighthouse performance score ≥ 90.
- **Data-freshness SLA** — region and pricing datasets refreshed automatically at
  least monthly, every provider showing a visible "data updated" date, and a diff
  report accompanying each refresh.
- **Test integrity** — every exported function and every user-visible feature is
  covered or explicitly waived with a reason, every guard has been proven to fail
  (by hand and, on the engine core, by a mutation score held above an agreed
  threshold), and the engine's must-always-hold properties are asserted over
  randomly generated input, not just enumerated cases. **Met for the application
  surface, not yet for the build tools** — the coverage ledger walks `js/` only, so
  no tool function is counted by it; see the practices list below. What is and is
  not covered is stated in [tests/README.md](tests/README.md).

## Engineering practices (continuous)

Not tied to any release — adopted once, then maintained every cycle:

- **Formatting gate in CI** — _in place._ `.github/workflows/ci.yml` runs
  `prettier --check` (alongside the test and type-check jobs) on every push and
  pull request, failing the build on anything unformatted. Auto-formatting and
  committing the fix from CI was considered and rejected: a bot commit would
  land without a changelog row or a version tag, putting holes in the
  per-commit version map. `npm run format` fixes it locally instead.
- **Test the build tools, and gate them like the app** — the behavioral-coverage
  ledger walks `js/` only, so **no build-tool function is counted by it at all**.
  The tools are exercised by `tests/suites/infra/`, but nothing requires that and
  nothing reports which of them has no test, which makes the gate's silence read
  as coverage it never claimed. The cost is not hypothetical: `split-data.js`
  rewrote every shipped data file for several releases with no suite of its own,
  and two tools were found reading region records through private loops no test
  named — one of them failing silently.

  The tools are not incidental to this project. They fetch, reconcile, diff and
  write the data the product recommends from, so a defect in one ships wrong
  answers to users exactly as a defect in the engine would, but without a user
  ever touching the code path that produced it. They deserve the same bar.

  Definition of done: extend the surface walk to `tools/` with its own tier — a
  tool's `main()` and its exported functions are the reachable set — hold every
  pipeline tool to covered-or-waived-with-a-reason, and pin each tool's CLI wiring
  as well as its helpers, since a green suite for a function nothing calls has
  already shipped here once. **Adopt before 4.0** — deliberately here rather than
  in [3.17](#317--closing-out-3x), whose charter admits only open
  [Known issues](#known-issues-patch-level), and a gate that under-claims is a
  practice gap rather than a product defect. Documented meanwhile under "What is
  NOT covered" in [tests/README.md](tests/README.md). _Partly paid down in
  [3.15](#315--data-model--catalogue-fidelity), which gave the splitter and the
  shared record contract their first suites — but by hand, which is precisely the
  mechanism this item exists to replace._ (M)

- **Dependency-CVE watch** — monthly, and before each release, check the
  vendored SheetJS builds under `js/vendor/` for advisories, treating the
  versions embedded in those artifacts as the source of truth (today `xlsx.full`
  0.20.3 and `xlsx-js-style` 0.18.5); refresh `SECURITY.md`, and keep an
  explicit "nothing leaves your browser" privacy statement current on the
  landing page. (S)
- **Deliberate logging policy** — the base and provider modules carry many
  `console.log` calls that clutter a normal user's console and make a real
  diagnostic hard to spot. Route diagnostics through one central logger gated by
  a `debug` flag (querystring or localStorage), silent by default, so logs are
  enabled intentionally rather than shipped on. Adopt once, then hold the line in
  review. (S)
- **Release hygiene** — keep [RELEASING.md](RELEASING.md) current: it is the
  release process (versioning, changelog, tagging, the pre-publish checklist)
  and it points at the service-worker cache rules in
  [CONTRIBUTING.md](CONTRIBUTING.md). (S)
- **Planning in the open** — track the adopted backlog on a public GitHub
  Project board and keep the issue templates current. (S)

## Minor releases

### 3.9 — Recommendation intelligence (complete)

Deeper, more accurate right-sizing: GPU workload support, storage pass-through,
percentile utilization, the burstable-preference rule, the SQL Server licence
floor, multicloud family-equivalence explainers, and the review-round fixes —
all recorded in the [changelog](CHANGELOG.md).

### 3.10 — Test foundation & CI gates

The suites are the reason the defects in this project get caught at all — and
they are also where several of them hid. This minor is pulled **ahead** of the
feature-heavy ones on purpose: build the safety net first, then land features on
it. Their weaknesses are known and specific.

- **End-to-end browser tests.** The Node suites verify logic but never a real
  browser: upload `.xlsx` → map columns → validate regions → generate → export,
  plus offline / PWA use. Add Playwright coverage for the four tool pages and a
  small cross-browser smoke matrix (Chromium + WebKit or Firefox) in CI. This
  also retires the standing manual browser-smoke debt and de-risks the 4.0 engine
  work before it begins. (L)
- **Accessibility regression gate.** Automated `axe` checks plus keyboard-only
  scenarios for the mapping dialog, filter controls, results tables, and exports,
  so the skip link, live regions, dark mode, and focus management already built
  cannot silently regress. Pairs with the accessibility audit in 3.11. (M)
  _Landed (v3.10.22): `axe` gates the four pages at zero violations in **light**
  mode, plus a dark-mode structural pass, a keyboard toggle, and a CSP-intact
  check. **Known debt, tracked for the 3.11 dark-mode pass:** the dark theme
  carries pre-existing `color-contrast` failures in several components (secondary
  buttons, the upload label, preset controls); the gate disables `color-contrast`
  in dark mode only until that pass clears them, then it flips on._
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
  a structural compare for xlsx. (M)
- **Property-based engine invariants.** The engine is enumerated case-by-case and
  pinned by goldens, but both only check the inputs someone thought to write down.
  A sizing engine has properties that must hold for _every_ input, and those are
  exactly where the silent wrong-size hides: the chosen instance always meets the
  required vCPU and memory (never sizes _below_ the requirement), a stricter
  utilization target never returns a _smaller_ box than a looser one, and No-Match
  is returned only when no candidate in the region can satisfy the row. Generate
  hundreds of random rows with `fast-check` and assert the invariants rather than
  specific outputs. Because it is the one suite needing a node_module, it is kept
  OUT of the dependency-free `run-all.js` and runs via its own `npm run
test:property` and a dedicated CI job. It catches the case nobody enumerated,
  which is the class every shipped defect here has belonged to. (M) _Landed 3.10._
- **Data-integrity / manifest suite.** The 141 region files and 3 manifests are
  generated by `tools/split-data.js`, but nothing asserts they _stay_ consistent
  with the monolith invariants over time: every key in each `{P}_REGION_KEYS`
  resolves to a loadable file, every region file defines the global its filename
  claims, and every instance carries the finite vCPU/memory/price and family the
  engine reads. It validates the shipped manifests and region artifacts directly;
  a split≡monolith round-trip is N/A (split-data is idempotent and the monolith is
  never committed, so there is nothing to re-split). A drift here is invisible
  until a specific region silently falls back to sample data in the browser —
  precisely the failure the split was built to make impossible. Pure Node, no new
  toolchain. (M) _Landed 3.10._
- **Visual-regression snapshots.** Snapshots the four provider pages in their
  empty, pre-upload state so a token rename or a CSS drift fails a check instead
  of a user noticing. Chromium-only, kept out of `npm run test:e2e`
  (`tests/visual/`, `playwright-visual.config.js`, `npm run test:visual`). Pixel
  baselines are OS-specific, so the committed set is the `-linux` PNGs generated
  on the ubuntu CI runner (via the `visual` job's manual `update_baselines` mode)
  — never on a contributor's machine; the gate stays neutral until they are
  committed, then guards. Deeper-view snapshots (dark mode, region chips, the
  results table) ride this rig in 3.11, alongside the accessibility work where
  visual drift most often bites. (S) _Landed 3.10._
- **Mutation testing — the final gate.** Execution coverage proves a line _ran_;
  it does not prove a bug in that line would be _caught_. Mutation testing is the
  measure that closes the loop: introduce a defect (`>` → `>=`, a dropped branch, a
  flipped boolean) and confirm a suite goes red — the automated, exhaustive form of
  this repo's plant-to-fail rule, run against `rule-engine.js` and
  `instance-selector-factory.js` where a survived mutant is a real hole. This is the
  highest-signal gate and it lands **last**, because it is the second real toolchain
  dependency (after Playwright): StrykerJS expects a test runner it understands,
  while this repo drives a bespoke `run-all.js` over a `vm` classic-script harness,
  so the integration — a command runner or a thin adapter — is the bulk of the work,
  not the mutations. Wired with StrykerJS over a single-process in-process oracle;
  break threshold set to 50 (baseline 53%), ratcheted up over later minors. (L)
  _Depends on the coverage gate and the tiered suites above; validates
  the engine-core guards it is scoped to (`rule-engine.js` and
  `instance-selector-factory.js`), not every guard this minor built._

### 3.11 — Accessibility, hardening & documentation

Broaden reach and shore up quality.

- Mobile / responsive audit — the PWA is installable, so phones are real users
  now. (M)
- **Shared page bootstrap.** `aws/azure/gcp/multicloud.html` each hard-code a
  long, near-identical ordered `<script>` list; `page-parity-test.js` only
  _detects_ the drift that invites. Extract one bootstrap that declares the base
  module set and load order once, so a new base module is added in a single place
  and the four pages cannot diverge — and new features get cheaper to ship. (M)
  _Pairs with the CSP handler rewrite below: both rewrite page wiring, so do them
  together._
- **Strict CSP migration.** Replace the generated HTML's inline `onclick` /
  `oninput` handlers with delegated listeners, and move the inline theme / UI
  styles into stylesheets, then drop `script-src 'unsafe-inline'` and
  `style-src 'unsafe-inline'` — the single biggest remaining hardening step. The
  handler rewrite pairs with the shared bootstrap above; the final flag-drop is a
  one-line CSP change once nothing inline remains. (L) _Preponed from 4.0 so the
  major stays the performance engine alone; use hashes / nonces where a handful of
  inline bits cannot practically move out._
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
- **Initial-load performance.** Region files are already lazy-loaded and XLSX
  code loads on demand, but individual region files run 250–400 KB and the two
  vendored spreadsheet bundles are ~1.4 MB together. Measure real cold-load and
  first-import times, confirm the XLSX bundles stay deferred until an `.xlsx` is
  chosen, and evaluate compressing or generating more compact data artifacts.
  Feeds the Lighthouse target below. (M)
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
- **Safe opt-in feedback.** The tool is client-side and collects nothing, and
  this must not change it. The only in-app path is a local, explicitly
  user-initiated "was this recommendation useful?" **export** — a file written
  to disk, no request made. If a "report an issue" affordance is offered at all,
  it is a plain GitHub link the user chooses to click: the browser's own
  navigation, which the user initiates and sees, never a background request the
  app issues — and its prefilled body carries a **free-text template only**, with
  no inventory, no recommendation rows, and nothing derived from the upload. Off
  by default; the app itself still makes no network call, so "nothing leaves your
  browser" holds unless the user deliberately navigates away. (S)
- `docs/ARCHITECTURE.md` — module map, data flow, worker protocol, storage
  keys. (M)
- Screenshots and short GIFs in the README and user guide (text-only today). (M)
- Troubleshooting section (worker unavailable, `file://`, blocked popups,
  storage full). (S)
- SEO / OpenGraph tags and a Lighthouse ≥ 95 target. (S)

### 3.12 — Input authoring & rule expression

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
  be explained without reading the engine. (M) _Feeds the user-defined rules UI
  below._
- **User-defined rules UI** — "if ENV = X, exclude family Y", stored and exported
  like presets. The engine already carries the underlying filters; this is the
  authoring surface over them. (L) _Preponed from 4.0: it is a rules-expression
  feature, not part of the sizing engine, and it belongs beside the rule work
  above. Builds on rule-fired transparency._
- **Right-sizing verdict per recommendation.** Each recommended instance already
  carries a computed delta from its source — the sizing-savings chips aggregate it
  — but no row says what the delta _means_. Label every recommendation with a
  verdict — Downsized, Upsized, or Same Size (delivered in 3.12.3); Family Changed
  and Generation Upgrade are future scope — the verdict does not yet compare
  instance families or generations, even though Current Instance Type is now an
  input — as a compact badge beside the instance, so a reviewer reads the sizing
  decision
  at a glance instead of diffing the vCPU / memory columns by eye. Pure
  presentation over data the engine already produces, provider-agnostic, and no
  pricing. (S) _Sits beside rule-fired transparency above; the input for the
  portfolio right-sizing bar chart below. Adapted from a reference migration report
  (ACCORD MPA) — its `ciRightsize` buckets — not copied: the pricing-driven parts
  of that report are excluded by the no-dollars rule (D8)._
- **Workload-shape explainer (RAM-per-vCPU).** Classify each row by its
  memory-to-vCPU ratio — compute-optimized, general-purpose, memory-optimized —
  and use it both to explain _why_ a family was chosen and to drive a workload-shape
  rollup on the Portfolio page. A provider-agnostic heuristic (ratio ≥ ~6 →
  memory, ≤ ~2.5 → compute, else general) over columns already in every upload.
  (S) _Feeds the workload-shape chart in the portfolio-visualization work below._
- **End-of-life OS advisory (delivered in 3.12.11).** When the upload carries an OS
  column, flag rows whose OS is past standard end-of-life (asking the reader to
  verify any ESU or ESM coverage) and suggest a modern landing OS (CentOS → Rocky /
  RHEL 9, Windows Server 2012 → 2022, and so on). Adjacent to
  the unknown-rule-values check above — the same "name what the input hides" spirit —
  but it borders on migration-assessment scope, so it ships only as a plain
  advisory that never gates a recommendation. (M) _Kept advisory-only on purpose:
  the tool sizes instances, it does not plan an OS migration._

### 3.13 — Cross-provider sizing

Size across providers, not just within one — preponed from 4.0 so the major
stays the performance engine alone. Neither item depends on that engine; both
build on data and columns the tool already has. This minor also folds in the
**portfolio-visualization** pass (KPI cards, inline-SVG distribution charts, the
RAM-per-vCPU workload-shape rollup, gradient headers) described in its own section
below: 3.13 is where its inputs — the 3.12 right-sizing verdict and workload-shape
classifier — already exist, and its verdict-distribution chart reads them directly.

- **Cloud-to-cloud mode** — derive a VM's specs from its current instance type
  using our own data, instead of requiring CPU and memory columns, and right-size
  across providers. The biggest missing use case. (L) _The `Current Instance
Type` column landed in 3.7 and is carried through to the outputs; what remains
  is deriving specs FROM it. Independent of the 4.0 engine — it changes what the
  tool can take as input, not how it chooses a size._
- **GCP custom machine types** — recommend custom vCPU/RAM shapes when standard
  sizes waste resources. (L) _A GCP candidate-generation enhancement, independent
  of the sizing policy engine._

### 3.14 — Data & pricing freshness

Keep the region datasets and the pricing the engine ranks on current —
automatically, and without the served page ever calling out.

**Shipped — all three items delivered.** The chosen approach: fetch both the
existing spec source and each provider's official pricing API, and **reconcile them
with the official API as the superior precedence**, so a scraped error cannot enter
the region files unchallenged (a field the API does not carry is kept from the spec
source but flagged unverified). Spec refreshes run monthly and pricing refreshes on
a longer, roughly quarterly cadence, since list prices change rarely — which avoids
unnecessary API calls; an empty diff opens no pull request. Each refresh lands
through a **reviewed pull request**, not a bot push to `main`, so the per-commit
version map stays hole-free.

- **Automated data refresh (build-time, CI).** A GitHub Actions job runs the
  `tools/split-data.js` pipeline on a schedule, refreshing the per-region
  instance files so a new family or a retired size does not wait for a hand-run.
  It all happens at build time — `connect-src 'none'` means the page itself never
  fetches anything. **Dependency:** the third-party source the region files are
  built from must be vetted first (its links and values verified by hand once),
  which is why this was deferred rather than shipped with the original split. (M)
- **Data-updated visibility & diff report.** Surface a clear "data updated" date
  per provider — and per region where they differ — so a user can see how current
  the basis of a recommendation is, and have each automated refresh emit a diff
  report (families added, sizes retired, prices moved) so a reviewer can judge not
  just how current the data is but how much it changed. Freshness is a confidence
  signal, and today it is only partly visible. (M) _The refresh job above produces
  the diff as a by-product._
- **Build-time pricing refresh.** The same job refreshes the pricing the engine
  ranks on, from each provider's public catalogue — **AWS** Price List Bulk API,
  **Azure** Retail Prices API, **GCP** Cloud Billing Catalog API. All three are
  free to read; the only real cost is repo and history growth, so the job bakes
  in **only the instance types × regions the app already ships**, never the whole
  catalogue. **Pricing stays internal, for ranking only** — the "no pricing in
  outputs" rule is unchanged; this is freshness, not a number on a report. The
  GCP catalogue's API key lives in CI secrets. (L) _Feeds 4.0's relative
  Optimization Impact, which needs current prices to rank well even though it
  never prints them._ ⚠ _GCP composes prices per vCPU and per GB, which omits the
  local-SSD component; the affected series stay unverified until
  [3.15](#315--data-model--catalogue-fidelity) closes that gap._

### 3.15 — Data model & catalogue fidelity

One structural change and the accuracy it unlocks. The region files repeat each
type's **specs in every region that offers it** — eight of the ten fields per
record are identical across regions, duplicated some 23,000 times for AWS alone,
and the three providers' region files come to roughly 23 MB. Splitting **specs
(per type)** from **prices (per type × region)** cuts that, serves the initial-load
budget in the success measures above, and turns every future field from a
per-region cost into a nearly free one. Until it lands, every field added to a
record multiplies by the number of regions carrying it — which is why the
catalogue work below waits on it rather than running first.

The split was expected to force a full regenerate. It did not: it was performed as a
pure re-serialisation of the data already committed, with every record proven
unchanged and no provider called. The fields the format could not previously afford
are therefore added to the pipeline here and **filled by the next scheduled refresh**
rather than by a hand-run capture — the automated job opens a reviewed PR on its own
cadence, so a manual one would only duplicate it. The practical consequence is that
the local-SSD price component ships dormant: no shipped record carries a storage size
until that run writes one, and until then every type composes exactly as before.

- **Specs / prices split in the region format.** Move the per-type specs out of
  the per-region records, leaving regions to carry pricing and availability. Touches
  `tools/split-data.js`, the manifest shape, `base-instance-selector`'s lazy region
  loading, the `sw.js` `CACHE` version, and the data-integrity suite. (L)
  **Decided (2026-09-01): a record is keyed `{service, type → specs}`**, with
  `compute` the only service for the foreseeable future — see
  [Later — beyond compute](#later--beyond-compute). One constant level of nesting,
  bought during a rewrite that is happening anyway, so that widening past virtual
  machines later does not mean migrating the format a second time. It commits to
  building none of that.
  The precondition was **measured, not assumed**: every one of the 3,203 shipped
  types carries byte-identical specs in each region offering it — 0 conflicts
  across all 96,395 records — so the split is lossless. That check becomes a
  permanent guard, because it is the only thing that would notice the day a
  provider ships a region-varying spec.
- **Test coverage for the tool that writes the shipped data.** Reopening the
  format made an old gap urgent: `tools/split-data.js` rewrites every region file
  and manifest in the repository and **had no suite of its own**, because the repo
  only ever held its output and the tool skips anything already converted. The
  split adds one, driving the real tool over a generated monolith across **all
  three providers** — necessary rather than tidy, since GCP is the only provider
  whose price fields sit mid-record and so the only one that would catch a
  positional partition bug. The shared record contract in `tools/lib/util.js` gains
  direct coverage of the specs/prices partition and of the serializer that refuses
  to emit a non-serializable value, and the splitter gains a round-trip
  self-check that runs before it writes anything — the old format could only lose a
  whole region, which failed to compile, while the two-part format can lose a
  single field, which compiles and ships. Progress against the build-tool coverage
  gap in the practices list, not a closure of it. (S)
- **Close the GCP local-SSD pricing gap.** GCP prices are composed per vCPU and
  per GB, which omits the local-SSD component, so `c4a`, `c4d`, `h4d`, `c4`, `c3d`
  and `z3` compose **6–33% low** and are kept unverified today. The specs feed
  carries `local_ssd` and `local_ssd_size`; the composition can use them. This is
  a ranking error, not a labelling one — the highest-value accuracy item on the
  list. (M) _Documented as a known limitation in `docs/DATA-SOURCES.md`._
- **Zero-priced instances are invisible** — see [Known issues](#known-issues-patch-level).
  **Decided (2026-09-01): they stay excluded, but the exclusion becomes visible** —
  the harm is not that an unpriced instance loses, it is that it disappears without
  a word; ranking one that has no price is the larger claim. (S) **Done.**

  It landed in two parts, and neither was quite what this item anticipated. The
  exclusion itself turned out to be **asking the wrong question** — the rule demanded
  a _Linux_ price, so it was deleting machines sold only with Windows; that is fixed
  by the OS-aware pricing above, and it did change recommendations, which is why this
  minor's single golden re-baseline covers it. What remains genuinely unpriceable is
  reported in the **refresh diff**, not in the product: an end user meets one of these
  only by asking for a 96-to-192-vCPU accelerator machine in one specific region,
  whereas a gap in incoming data that nothing reports is precisely how this one
  survived unnoticed — and long enough that the count recorded here was nearly half
  short. The audience for the notice was the maintainer all along.

### 3.16 — Attribute filters & rule fidelity

Spend what 3.15 makes affordable: replace the engine's admitted proxies with the
measurements the providers actually publish, and offer the attributes the data has
always carried.

- **Turn three proxies into measurements.** Rule 1d prefers `vCpus >= 4` as an
  explicit stand-in for a higher network tier — the feeds carry real bandwidth
  (AWS baseline/burst Gbps, GCP network performance, Azure accelerated networking).
  The SQL Server rule sets a vCPU floor while its own rationale is that SQL Server
  is **licensed per core** — AWS publishes `cores` and Azure `vcpus_percore`, which
  is the exact figure. Burstable detection is a hardcoded family list plus a
  shared-core name pattern — GCP publishes `shared_cpu`, and AWS's burst fields mark
  exactly the burstable set, so a future `t5` would classify itself. (M)

  _This item listed a fourth — **Windows support**, inferred by excluding Arm while
  every record carried a Windows rate no product code read. It was **done early, in
  [3.15](#315--data-model--catalogue-fidelity)**, because the same root cause was
  already being fixed there: the price field named the Linux rate on all three
  providers, so a Windows row was ranked on a price it would never pay. The Arm rule
  remains for GCP alone, whose Windows price is composed rather than published and so
  cannot say what runs Windows. See the resolved Known issue below._

- **Instance attribute filters.** A numeric GPU count (all three clouds publish
  one) replaces the family-name regex the accelerator check uses today; bare metal
  becomes an exclude type rather than competing as an ordinary very large instance;
  confidential computing becomes a compliance option, which the Compliance rule and
  AWS's already-consumed Nitro Enclaves support make a natural fit. (M)
- **Expand the workload vocabulary.** The engine recognises eight workload concepts
  in twenty-four tokens, matched by exact lookup, and **anything it does not
  recognise falls back to general-purpose families**. A real inventory is full of
  roles with no entry — analytics and Spark, file and backup servers, NoSQL and
  search clusters, application and middleware servers, container hosts, build
  farms, domain controllers and jump boxes, and further out VDI, media
  transcoding, message brokers and network appliances. Each is a row in a table:
  no data change, no format change, no new fetch, which makes it the cheapest
  accuracy work left in the engine. The recognised-value list is derived from one
  provider's table, so **a token added to one provider and not the others would
  make the upload hygiene check report a value as recognised while no rule reads
  it** — the vocabularies must move together, and a test should say so. (M)
- **Let the sample gallery demonstrate what the tool can do.** The gallery already
  offers three labelled datasets on every tool page, but the builder they share
  emits only ten columns and omits Compliance, Min Gen, Exclude and Current
  Instance Type. So **no sample can demonstrate cloud-to-cloud sizing or the
  compliance rules**, and the samples between them use five of the eight workload
  values. Widen the builder to the full canonical column set and add a dataset
  whose rows each light up a different optional column. Paired with the item above,
  because expanding a vocabulary that no sample ever shows is half a feature. (S)

### 3.17 — Closing out 3.x

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
  (S) _The allow-list work in 3.12 is the natural home for the first option._

### Portfolio visualization (delivered in 3.13)

The Portfolio page once reported only in tables and text; a reference migration
report (ACCORD MPA) makes the same class of data far more legible with cards and
charts. 3.13 delivered this pass — a presentation change, not a data change, every
piece built in **inline SVG / CSS with no new runtime dependency** — which keeps it
inside the strict-CSP direction (`script-src 'self'`, [3.11 CSP migration](#311--accessibility-hardening--documentation))
rather than pulling a charting library or a CDN. The pieces, as shipped:

- **KPI card row.** Replace the top-line counts with accent-barred KPI cards
  (label / value / sub-line): servers in scope, distinct applications, environment
  split, match rate. CSS only, high polish for the effort. (S)
- **Distribution charts.** A doughnut for the family / provider / environment mix
  and a bar for the right-sizing-verdict distribution (from the 3.12 verdict item),
  rendered as inline SVG so they snapshot cleanly under the existing
  visual-regression rig. (M)
- **Workload-shape rollup.** Summarise the RAM-per-vCPU workload-shape
  classification (estate.shapeMix — compute / general / memory) across the estate,
  so a portfolio reads as "mostly memory-optimized" at a glance. _Built on the 3.12
  workload-shape explainer._
- **Gradient section headers.** Adopt banded headers for the portfolio's major
  blocks — a small, self-contained CSS lift that reads better across the page. (S)

_Explicitly out, by our own rules:_ everything the reference report builds on
**pricing** — on-demand / reserved cost cards, savings bands, annual run-rate, the
live AWS pricing-calculator estimate — is excluded by the no-dollars-in-outputs
rule (D8), along with its AWS-only, migration-wave, and connectivity-navigator
views. The delivered charts each gained a visual-regression baseline, since new
charts want new snapshots.

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

### 4.0 — Performance-based right-sizing engine

One platform-defining shift: a policy-driven, per-row sizing engine — and only
the work built directly on it. Cloud-to-cloud, GCP custom shapes, the
user-defined rules UI, and the strict-CSP migration have been **preponed into the
3.x series** so this major stays a single coherent theme rather than a bundle.
**Gated on 3.17:** no known issue crosses this line.

- **Performance-based right-sizing engine** — the flagship. Today's Optimization
  pass sizes on one statistic chosen for the whole run; 3.9.3 gave that statistic
  three values (Average / p95 / Peak) with per-row fallback and a `Sized On`
  column, and 3.9.9 made CPU and memory resolve independently. This turns it into
  a **policy-driven** engine that chooses the sizing statistic **per row** from
  the workload's risk profile, and combines statistics for a safety check rather
  than trusting one. (L) _Builds directly on the 3.9.3 / 3.9.9 resolver; stores
  its policy the way presets and the [3.12 user-defined rules UI](#312--input-authoring--rule-expression)
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

  **Benchmark normalisation is deliberately not part of this.** The specs feed
  publishes a CoreMark score for most AWS types, which would allow sizing on
  measured throughput instead of vCPU-count equivalence. It is **AWS-only** — no
  equivalent exists for Azure or GCP — so it cannot serve the cloud-to-cloud
  comparison that is the point of this tool, and a normalisation that works on one
  provider would make multicloud rows silently incomparable. Recorded here so the
  option is not rediscovered without its blocker. _Revisit only if a comparable
  figure appears for the other two._

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
  it. The 4.0 evolution of the 3.12 validated template: multi-sheet, and carrying
  the Criticality and percentile columns the performance engine adds. (M) _Open
  question: SheetJS Community's data-validation **write** support is limited, so
  authoring the dropdowns may need a second tool; reading the workbook is
  unaffected. This is the one 4.0 input feature kept here rather than preponed,
  because it exists to carry the engine's own new columns._

- **Not 4.0: predictive / ML sizing.** Two structural blockers. `connect-src
'none'` means no model can be called over the network, so anything predictive
  would run client-side against a vendored model; and, more fundamentally,
  prediction needs a **time series**, while the input is a single snapshot per VM.
  Per-VM history is a data-model change, not a sizing tweak. Revisit only if the
  input format ever grows a time dimension.

## Later — beyond compute

**Not scheduled, and not committed to.** Recorded so the shape of the decision is
written down before anyone starts, rather than discovered halfway through.

Today the tool sizes **virtual machines**. The natural expansion is the managed
services alongside them, each with a cross-provider equivalent:

| Compute-adjacent     | AWS    | Azure                               | GCP                 |
| -------------------- | ------ | ----------------------------------- | ------------------- |
| Relational database  | RDS    | Azure SQL / Database for PostgreSQL | Cloud SQL           |
| Managed Kubernetes   | EKS    | AKS                                 | GKE                 |
| Serverless functions | Lambda | Functions                           | Cloud Run functions |
| Object storage       | S3     | Blob Storage                        | Cloud Storage       |

**What makes this a structural change rather than more data.** Every layer assumes
one record shape — a type with vCPU, memory and a price, offered in a region — and
that assumption reaches further than the data layer: the upload's column vocabulary,
the rule engine's ENV/OS/Workload axes, the family-equivalence fold, and the exports
all speak it. The managed services do not fit it. A database is sized on engine,
storage and IOPS with a Multi-AZ multiplier; Kubernetes splits a control plane from
node groups that are themselves VMs; serverless has no instance at all and prices on
memory × duration. Sizing rules that assume "pick a machine that fits the CPU and
memory" do not carry across.

⚠ **The cheapest moment to leave room is [3.15](#315--data-model--catalogue-fidelity)**,
the one release that deliberately reopens the record format. Deciding there whether a
record is keyed `{type → specs}` or `{service, type → specs}` costs almost nothing
during a rewrite that is happening anyway, and is expensive to retrofit afterwards.
That is a decision to take knowingly in 3.15 — not a commitment to build any of this.

## Known issues (patch-level)

Tracked and fixed continuously rather than scheduled into a release — but this
list is also the whole content of [3.17](#317--closing-out-3x), and **4.0 does
not ship while anything is on it**. A known defect carried into a major release
says the new path was reached for instead of the old one being finished.

- The **instance-family-name filter is unreachable**. `restrictInstanceFamilyNames`
  is read by the engine, the option gatherer, the presets, and the scenario diff,
  but no page renders its checkbox — so the filter can never be switched on, and
  its nearest-miss probe can never fire. Either give it the UI the rest of the
  code already expects, or remove it from all of them. _Scheduled in 3.17; the
  allow-list work in 3.12 is the natural home for the first option._
- **The GCP processor filter cannot match the data** — the same species as the
  entry above. `gcpAdvancedFilterData.processorPlatforms` offers named platforms
  (`Intel Skylake`, `AMD Rome`, `ARM Ampere Altra`, …) while the shipped records
  carry only `Intel`, `AMD` or `ARM`, so nothing a user ticks can ever match a
  record. Either populate the list from the values the data actually uses, or drop
  it. _Scheduled in 3.17 alongside the filter above._
- **~~Zero-priced instances are dropped from every run, silently.~~**
  **Resolved in [3.15](#315--data-model--catalogue-fidelity).** `isValidInstance`
  required `price > 0` — a **Linux** price — so any record the feeds priced at zero
  was discarded before ranking. Measured 2026-09-01: thirteen types across
  thirty-seven records.

  **The wrong half of the exclusion went first.** The rule
  now keeps a machine priced for **at least one** OS, and the row is ranked on its own
  OS's price, which recovers the types that were only ever dropped for lacking a
  _Linux_ price: `u-6tb1.metal` (13 records — no published Linux rate in any region,
  so a 6 TiB machine could not be recommended to anyone) and `p5.4xlarge` (5).

  **The silence is closed too.** Eleven types carry no price for either OS (measured
  2026-09-03): on AWS `p4d.24xlarge`, `p5.48xlarge`, `p5en.48xlarge`,
  `p6-b200.48xlarge` and `p6-b300.48xlarge` (13 records); on Azure the six
  storage-optimized sizes `l8asv3` through `l80asv3` (one region each, all
  `spaincentral`). They are still excluded — nothing can be ranked without a price —
  but the refresh diff now reports them every run, naming the regions that carry no
  price and counting the regions that do.

  That count is the point. A feed states "not offered here" by **omitting** the
  record, so a record that is present with every price at zero is a different
  statement: a gap, not a withdrawal. All eleven are priced in other regions
  (`l8asv3` in 53 of 54), which identifies them as publication lag on new hardware
  and one new region. The report is deliberately **not** a "change" — a standing gap
  must not open a refresh PR every month for as long as it persists upstream.

  It went to the maintainer report rather than the UI on purpose: an end user would
  only meet one of these by asking for a 96-to-192-vCPU GPU machine in one specific
  region, whereas a feed gap that nothing reports is how this one survived unnoticed
  in the first place. Not to be confused with a zero **Windows** price, which is
  carried by thousands of records and states that the type does not offer Windows;
  that is now read as such. **Closed in 3.15.**

- **~~Windows support is decided by a proxy that misses dozens of types.~~**
  **Resolved in [3.15](#315--data-model--catalogue-fidelity)** (was scheduled for
  3.16). The OS rule treated "not ARM" as "runs Windows", so a Windows row could be
  recommended a type the provider never offers for Windows: **28 AWS and 15 Azure
  non-ARM types**, 443 records, covering the AWS inference and FPGA families
  (`inf1`, `inf2`, `f2`), `p4d`, and Azure's `nc`/`nv`/`nd` GPU sizes and `m96`. The
  root cause was larger than the proxy — `mapping.price` named the **Linux** field on
  all three providers, so a Windows row was both filtered and ranked on a price it
  would never pay. The price is now selected per row from the row's own OS, which
  removes the need for a proxy on the two providers that publish a Windows rate.
  Both constraints recorded here were honoured: the rate is read **per region**
  (the pool is built from the region's own records, not from a per-type property),
  and the zero was corroborated before it was allowed to filter — every shipped
  record carries the field, so a zero is distinguishable from an absence, and on
  AWS the signal independently reproduces a documented fact, marking **381 of 381**
  Arm types in `us-west-2` and **304 of 304** in `eu-west-1` as Windows-less.
  **The Arm rule stays**, because on GCP it is still the only real signal — see the
  Windows-pricing note in `docs/DATA-SOURCES.md` for why GCP's Windows price cannot
  be used this way.
- **The background region pre-warm is unreachable.** `preloadAllRegions` would load
  every region of a provider in the background, and nothing in the product or the
  tests ever calls it. So the only region data ever fetched is what an upload names,
  and the method is dead code that reads like a live optimisation. Either wire it to
  a deliberate trigger or remove it. _Found while planning
  [3.15](#315--data-model--catalogue-fidelity); scheduled in 3.17. The specs/prices
  split makes the version that does run far cheaper, so decide after it lands._

## Suggesting an item

Ideas are welcome — open an issue or a discussion (see
[CONTRIBUTING.md](CONTRIBUTING.md)). Concrete, self-contained proposals are the
easiest to pick up.
