# Rule Engine API

`window.RuleEngine`, defined in [`src/core/rules/rule-engine.js`](../../src/core/rules/rule-engine.js), is the ENV/OS/Workload/Compliance/MinGen policy engine every provider selector runs candidate instances through before ranking. This document is its published, versioned boundary — the part of the module a reader outside this codebase (or a future internal consumer) can depend on without reading the implementation, and the part this project commits to not changing shape without a version bump and a changelog entry below.

This is 3.20's groundwork step for treating the rule engine as a product surface in its own right, not just the internals of the CSV-upload sizing tool wrapped around it (see `ROADMAP.md`'s `### 3.20` section). It does not yet commit to external distribution (no npm package, no separate build) — it commits to the surface being stable and documented where it already lives.

## How to load it

There is no build step in this project (see `.claude/rules/coding.md` §9 for the constraints this implies — classic scripts, one global scope, `connect-src 'none'`). `rule-engine.js` is a plain `<script>` that assigns `window.RuleEngine` once loaded; nothing else it depends on beyond the browser global object. Loading it standalone (without the rest of the app) is sufficient to call every function documented below — it reads no other global and touches no DOM.

## Version

`RuleEngine.apiVersion` — a SemVer string. See [API changelog](#api-changelog) below for what each version changed. This tracks the shape of the surface documented here, independently of the app's own `CHANGELOG.md` version map (an app patch can ship with no change to this surface at all, and vice versa is not expected but not architecturally prevented).

Current: **1.0.0**

## Stable surface

These are the members a consumer should treat as a real contract — signature and behavior change only with a version bump and a changelog entry.

### `apply(instances, options, provider)`

The main entry point. Filters and sorts a candidate `Instance[]` against one row's resolved rule inputs (`RuleOptions`), for one `Provider` (`"aws" | "azure" | "gcp"`). Returns `{ instances: Instance[], rules: string[] }` — the surviving/reordered candidates, plus a human-readable audit trail of which rules fired and how many candidates each one removed (or why a rule reports "not applied"). Every rule this file implements is described in the file's own header comment block (Rule 1a–1d, OS, MinGen, Workload preference, GPU, SQL, Burstable preference) — that comment block is the rule reference; this document is the API boundary around it, not a restatement of the rules themselves.

Never throws on malformed input: an unrecognised ENV/OS/Workload/Compliance/MinGen value is treated as "no rule fires for this value" and reported as such in the `rules` array, never silently guessed into a different value (`.claude/rules/coding.md` §1 — never a plausible wrong answer).

### `RECOGNIZED`

`{ env: string[], os: string[], workload: string[], compliance: string[] }` — the exact vocabularies `apply()` matches against, lowercase. This is the canonical source for "what values does the engine actually read" (see `docs/data/CANONICAL-SOURCES.md`'s "Recognised ENV / OS / Workload / Compliance values" row) — read live by the upload-time hygiene check and the XLSX template, never copied. A value not in the relevant list is not a rule input the engine recognises; for OS specifically, anything not matching `os` falls through to the Linux default rather than being flagged (real inventories carry many distro strings that are correctly "not Windows/macOS," not user error).

### `WORKLOAD_FAMILIES`

`{ aws: {...}, azure: {...}, gcp: {...} }` — per-provider workload-name → preferred-family-prefix-list map. `RECOGNIZED.workload` is derived from `WORKLOAD_FAMILIES.aws`'s keys; all three providers' key sets are pinned identical by `tests/suites/engine/workload-vocabulary-parity-test.js`, so reading any one provider's keys is equivalent to reading the recognised workload vocabulary.

### `getPreferredFamilies(workload, provider)`

`(string, Provider) => string[]`. Looks up `WORKLOAD_FAMILIES`, falling back to `"general"` for an unrecognised or blank workload. Pure, no side effects.

### `meetsMinGeneration(inst, minGen, provider)`

`(Instance, string, Provider) => boolean`. The single generation-comparison parser both the MinGen filter and the Newest-Generation alternative-pick strategy (`generationRank`, below) use — see the source file's `azureVersion`/`azureRank`/`GCP_GEN_ORDER` for why one parser exists rather than two. `minGen` is always native to the given provider (an AWS family number, an Azure v-number, or a GCP family name) — this function does not translate between clouds.

### `generationRank(inst, provider)`

`(Instance, Provider) => number`. A comparable "newness" ordinal, higher is newer, for ranking rather than filtering (`meetsMinGeneration` is for filtering). Guaranteed to use the same underlying parse as `meetsMinGeneration` for Azure and GCP, so the two can never disagree about what counts as newer.

### `isWorkloadFit(instance, reqCpu, reqMemory)`

`(Instance, number, number) => boolean`. True when `instance` is close enough in size to `reqCpu`/`reqMemory` that honoring a workload preference for it would not amount to gross over-provisioning (bounded at 2× vCPUs / 4× memory — see the source file's `WORKLOAD_MAX_CPU_FACTOR`/`WORKLOAD_MAX_MEM_FACTOR`). With both bounds `0`/falsy, always true (no requirement to bound against).

## Internal surface (exposed, not yet a stability contract)

These are real exported functions — every one of them is called from elsewhere in this codebase — but their signatures track internal callers' needs first. They may gain parameters or change return shape across a patch release without a changelog entry here; a consumer that needs one of these classifications as a stable contract should ask for it to be promoted to the stable surface above, not depend on it as-is.

`isAccelerator`, `isBurstable`, `isCurrentGen`, `isARM`, `isFlagTrue`, `isWindowsOS`, `hasNetworkTier`, `burstBandwidthGbps`, `physicalCores` — each is documented in-line in `rule-engine.js` next to its definition; that inline documentation is authoritative for behavior, this list exists only so `tests/suites/infra/rule-engine-api-spec-test.js` can confirm every exported key on `window.RuleEngine` is accounted for somewhere in this document (stable or internal), so an export added or removed here is never silently undocumented.

## Data shapes

`Instance` and `RuleOptions` are documented as JSDoc `@typedef`s at the top of `rule-engine.js` itself — that is their canonical, always-current form (a hand-copy here would drift the moment a field is added). Read them there; this document does not restate them.

## API changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.0.0 | 2026-09-28 | Initial published surface. No behavior change from the pre-existing `RuleEngine` module — this version marks the existing return-object shape as the documented, versioned boundary for the first time (3.20). |
