# Canonical sources

A registry of facts that exist in more than one place in this codebase by
necessity — a value list, a field order, an enum — mapped to the ONE file
that owns each and everywhere else that reads it. Check this before adding a
new consumer of a shared fact, and before deciding a fact needs a canonical
source it doesn't have yet.

**Why this file exists.** Two 3.15 bugs and one 3.16-era fix shared one root
cause: a second, independent copy of a list that already existed elsewhere
silently fell behind the original when a value was added to one and not the
other, and nothing caught it because nothing checked the two against each
other. The rule that follows from that — [CONTRIBUTING.md's Code
Style](CONTRIBUTING.md#code-style) — says to derive from a canonical source
instead of retyping one. This file is what makes that checkable: it names
where each canonical source actually is, so "does this already exist
somewhere" is a lookup, not a grep-and-hope.

| Fact                                                                | Canonical source                                                                                                                 | Consumers                                                                                                                                                                      | Kept in sync by                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-provider price/spec field membership + emit order               | `tools/lib/util.js` (`FIELD_ORDER`, `specFields()`, `priceFields()`)                                                             | `fetch-vantage.js`, `split-data.js`, `data-diff.js`, `reconcile-data.js`                                                                                                       | `data-integrity-test.js`, `split-data-test.js`, `lib-util-test.js`, `data-diff-test.js`, `reconcile-data-test.js`                                                                                                                                                                                                                                                     |
| Recognised ENV / OS / Workload / Compliance values (upload hygiene) | `js/base/rule-engine.js` (`RuleEngine.RECOGNIZED`)                                                                               | `js/base/ingest.js` (hygiene check), `js/base/xlsx-export.js` (template)                                                                                                       | Read live from `RuleEngine.RECOGNIZED` at call time, never copied. ⚠ `RECOGNIZED.workload` is AWS's family-key list only, ASSUMED identical across providers — not verified; see the [ROADMAP](ROADMAP.md#316--attribute-filters--rule-fidelity) item on the workload vocabulary.                                                                                     |
| User-defined-rule dimensions + actions                              | `js/base/user-rules.js` (`USER_RULE_DIMENSIONS`/`USER_RULE_ACTIONS`, via `userRuleDimensionOptions()`/`userRuleActionOptions()`) | `js/base/user-rules-ui.js` (the panel's two dropdowns)                                                                                                                         | `tests/suites/ui/user-rules-ui-test.js`. Fixed 2026-09-03 — the UI used to hand-list both sets independently.                                                                                                                                                                                                                                                         |
| Column auto-mapping synonyms                                        | `js/base/app-core.js` (`COLUMN_SYNONYMS`)                                                                                        | `js/base/ingest.js`                                                                                                                                                            | Single real consumer; low risk, listed for completeness.                                                                                                                                                                                                                                                                                                              |
| Per-provider region availability                                    | The shipped manifest (`{P}_REGION_KEYS` in `js/{p}/{p}-data.js`)                                                                 | The hardcoded `awsRegions` list (`js/aws/aws-instance-selector.js`) and Azure's display-name map (`js/azure/azure-instance-selector.js`), which feed manual-entry autocomplete | **Not code-derived, deliberately** — manifest keys aren't human-friendly for a dropdown, so this is a genuine second list, not a hand-copy mistake. `tests/suites/lazy-test.js`'s "every manifest region is offered for autocomplete" check is what actually keeps the two in agreement — if you add a region, update the hardcoded list too, or that test tells you. |

## Adding an entry

A fact belongs here when it's read by more than one file and retyping it
would be a plausible mistake — not every constant in the codebase, only ones
where a second copy could silently exist. When you introduce a canonical
source (or find you're about to duplicate one that should have been), add a
row: the fact in plain words, the file and export that owns it, every real
consumer, and whatever actually keeps them honest — a shared import, a live
read, or a test that checks the two sides agree when the values genuinely
can't be unified (like the region-availability row above).
