# Releasing

How a minor moves from an empty branch to a published release. The app is a
static site with no build step, so "releasing" is really three things: keeping
the version record honest, running a minor's work on its own branch so a
release always points at a complete, coherent line, and knowing the few cases
where the service worker needs a nudge.

This describes the maintainer's own flow for developing a themed minor. A
one-off outside contribution is simpler and unaffected by any of this: fork,
branch from `main`, open a PR per [CONTRIBUTING.md](CONTRIBUTING.md#pull-request-guidelines) —
that PR lands as its own commit under whichever minor is open when it merges.

## Where versions live

**Only in [CHANGELOG.md](CHANGELOG.md) and git tags.** No version string appears
in the README, the user guide, the pages, or `package.json` — there is nothing to
hand-bump, and nothing that can drift.

The project uses [Semantic Versioning](https://semver.org), applied per commit:

- **MAJOR** — a platform-defining shift (the `4.0` line in
  [ROADMAP.md](ROADMAP.md)).
- **MINOR** — a feature release. Each is a themed group of work, and each has a
  `### x.y` section in the changelog's version map.
- **PATCH** — one commit inside a minor: a feature increment, a fix, a review
  round, a docs change, or a formatting pass.

So every commit gets a version, a changelog row, and an annotated tag.

## Opening a minor

1. **Branch.** Cut `release/<minor>` off `main` — every commit for the whole
   minor lands here, never on `main` directly. `main` only moves when the line
   is fast-forwarded onto it at the very end (see
   [Landing the line](#landing-the-line)), so it always reflects either the
   previous minor, complete, or this one, complete — never a partial one.
2. **Open the version-map heading** in `CHANGELOG.md`: `### <minor> — <theme>
(YYYY-MM-DD → )`, end date left blank until the line closes. First commit on
   the branch.
3. **Plan the whole minor before writing code.** A themed minor is a planned
   body of work, not step-at-a-time improvisation — lay out the intended
   phases and what each will deliver before starting the first one. The plan
   is a working map, not a contract: amend it as the work discovers more.
   (Where that plan lives is a maintainer tooling detail outside this repo;
   what matters here is that the planning happens first.)
4. **Rotate [ROADMAP.md](ROADMAP.md)'s Now/Next/Later** to reflect the minor
   now in progress.

## Landing a commit

Every commit on the branch follows the same loop:

1. **Verify.** All four must be clean. `npm ci` first on a fresh checkout —
   Prettier and TypeScript are dev dependencies, so the two `npm run` steps fail
   without it (the two `node` steps need nothing installed):

   ```bash
   npm ci                  # once per checkout, or after package.json changes
   npm run format          # or format:check — CI fails on unformatted files
   node tests/syntax-check.js
   node tests/run-all.js   # suites + golden byte-compare
   npm run typecheck
   ```

   If the change touched a guard or a test, plant the bug it exists to catch
   and watch it go red before trusting it — a green test proves nothing until
   it has been watched fail.

2. **Update the version map** at the top of [CHANGELOG.md](CHANGELOG.md):
   - Replace `_this commit_` in the previous top row with that commit's real
     short SHA (`git rev-parse --short HEAD`).
   - Add a new top row for the change you are about to commit, with
     `_this commit_` as its SHA and a sentence describing what the change does —
     written for a reader, not a diff.

   A commit cannot contain its own hash, which is why the tip row always
   carries the placeholder and the next commit backfills it. **Exactly one row
   should ever say `_this commit_`**, and every row's cells must survive the
   table it sits in — `tests/suites/infra/changelog-integrity-test.js` checks
   both automatically as part of `node tests/run-all.js` (step 1), so a missed
   backfill or a stray unescaped `|` in the row's prose fails the same gate as
   everything else, not a command run from memory.

3. **Commit and tag:**

   ```bash
   git commit -m "..."
   git tag -a v<next-version> -m "<next-version> — short description"
   ```

4. **Stay on the branch.** Commits and tags accumulate on `release/<minor>`
   while the line is open — nothing is pushed and nothing is published until
   the whole minor is done (see [Landing the line](#landing-the-line)). This
   is also what makes abandoning a bad direction cheap: nothing outside the
   local branch has seen it, so backing out is deleting a branch, not
   unwinding a release.

## Closing a line

Once every feature on the minor's plan is built, the line is not done —
finish these before touching the release sequence:

1. **Run a deliberate regression hunt** over the whole minor's own diffs, and
   fold any review-tool findings, before calling the feature list closed.
   Every finding a review pass surfaces gets an explicit disposition — fixed,
   confirmed stale, rejected with evidence re-checked against the current
   branch, or knowingly deferred — checked off **individually**, never by the
   file it sits in. A file already touched by an earlier round is not a
   finding already answered. Specifically grep for a **second, independent
   copy of a fact this minor's diffs touched once** — a field list, an enum,
   a threshold — the kind of drift a hand-copy introduces silently and no
   test catches until it's acted on. [CANONICAL-SOURCES.md](CANONICAL-SOURCES.md)
   names where each known shared fact actually lives, and
   [CONTRIBUTING.md's Code Style](CONTRIBUTING.md#code-style) has the rule
   for deriving from one instead of retyping it.

2. **Check the documentation for divergence from what actually shipped.**
   `npm test` already pins the mechanical parts of this continuously —
   `tests/suites/infra/docs-currency-test.js` fails the moment README,
   CONTRIBUTING, or the refresh runbook drifts from the files, tools, or
   pipeline order they claim to describe. That pin catches a file existing and
   going unlisted; it does not catch a real, shipped, user-facing feature
   going unmentioned in prose anywhere a user would read it — that takes a
   deliberate pass:
   - Walk this minor's CHANGELOG entries and confirm every user-facing change
     is described somewhere a user would actually find it (README's feature
     list, `user-guide.html`, or both) — not just in the commit message.
   - If a project-structure tree (README's or CONTRIBUTING's) or a feature
     description was touched, re-run `npm test` and confirm
     `docs-currency-test.js` is still the thing enforcing it, not a one-time
     manual fix that will drift again next minor.
   - Read through README, CONTRIBUTING, `docs/DATA-SOURCES.md`, and
     `tests/README.md` for anything the minor's own work made stale — a
     module renamed, a pipeline step reordered, a limitation resolved that a
     doc still lists as open. A doc that reads as complete while quietly
     wrong is worse than one that admits a gap.

3. **Re-baseline anything the minor's work moved.** A golden that shifted, a
   coverage inventory that changed shape, a mutation score that moved —
   confirm each is a real, attributed consequence of this minor's changes
   before accepting it, never assumed.

4. **Set the end date** on the minor's version-map heading in
   `CHANGELOG.md` (`(YYYY-MM-DD → YYYY-MM-DD)`) and **write its section under
   Release notes** — the minor's story, for a reader, drawn from its own
   version-map rows.

Only once all four are done is the line ready to land.

## Landing the line

**Publish only once the line is closed.** A release points at one tag and
nothing moves it afterwards, so a release cut while its line is still open goes
stale the moment the next patch lands: it keeps advertising a fraction of the
work, and readers of the releases page never see the rest. (This is not
hypothetical — `3.5` was published at `v3.5.10`, ran on to `v3.5.26`, and spent
a day claiming sixteen fewer commits than it shipped.) For the same reason,
**push and publish happen once, at the end** — never as commits land.

### Merge policy: fast-forward only, never squash or rebase

**`main` only ever moves by fast-forward.** A minor's branch merges onto it
whole — every commit and every one of its annotated tags carried across
unchanged — never squashed into one commit and never rebased into new SHAs.
This is what makes the history **fully recoverable**: at any point after a
release, every intermediate state of the minor — each patch, each tag, each
CHANGELOG row — is still a real, checkable commit on `main`, not a single
opaque merge commit that discarded the steps in between. GitHub's own merge
button cannot do this ("Squash" and "Rebase and merge" both rewrite SHAs,
orphaning every tag the line already carries), so landing the branch is always
the direct push in step 4 below, never the button on the PR page.

**The one exception:** the automated `data-refresh.yml` PR and Dependabot PRs
may be squash-merged from GitHub's button. Neither carries a per-commit
CHANGELOG row or an annotated tag to orphan — the data-refresh content is
never changelogged (the tooling that produces it is, separately), and a
Dependabot bump is a single mechanical commit — so squashing loses nothing
the fast-forward policy exists to protect.

1. **Push the branch and its tags:**

   ```bash
   git push origin release/<minor> --tags
   ```

2. **Regenerate visual baselines, if this minor could have moved a screenshot.**
   Baselines are OS-specific and must come from the Linux CI runner, never a
   contributor's machine:

   ```bash
   gh workflow run ci.yml --ref release/<minor> -f update_baselines=true
   ```

   Download the `visual-baselines-linux` artifact, review every changed PNG,
   and commit them to the branch before continuing.

3. **Open the release PR** (`release/<minor>` → `main`) and get all CI jobs
   green.

4. **Merge fast-forward** (see [Merge policy](#merge-policy-fast-forward-only-never-squash-or-rebase)
   above) — a direct push, not GitHub's merge button:

   ```bash
   git push origin release/<minor>:main
   ```

   GitHub then auto-closes the PR as merged, with no rewritten history.

5. **Move your local `main` ref**, or a later `git rebase main` silently
   rebases onto the stale base and reports "up to date":

   ```bash
   git branch -f main origin/main
   ```

6. **Dry-run the data-refresh workflow**, if this minor touched the refresh
   pipeline or the shipped data format:

   ```bash
   gh workflow run data-refresh.yml --ref main -f dry_run=true
   ```

   This must come **after** the merge, not before — `workflow_dispatch` can
   only target a branch the workflow file already exists on, and until the
   fast-forward lands, `main` doesn't have this minor's version of it.

7. **Publish the release**, from the highest tag of the line, with notes drawn
   from the **Release notes** section written while [closing the
   line](#closing-a-line):

   ```bash
   gh release create <highest-tag-of-the-line> --verify-tag \
     --title "<minor> — <theme>" \
     --notes-file <notes>

   # --latest ONLY when this is the newest line. It is not a formality: passing
   # it while publishing, say, a late 3.6 patch would move "Latest" backwards
   # off 3.7, and the releases page would recommend the older line to everyone.
   ```

   The tag must already be on `origin` — `--verify-tag` will refuse otherwise.

8. **Delete the branch**, local and remote, once its tip is a proven ancestor
   of `origin/main`.

**Title the release `<minor> — <theme>`** — the same theme the minor carries in
the roadmap and in its version-map heading, em dash included (for example
`3.8 — Results, visualization & reporting`). The releases page is a list of bare
numbers otherwise, and a reader deciding whether an upgrade matters to them
should not have to open each one to find out what it was about.

This settled a drift: earlier lines (`3.4`–`3.6`) were published as bare numbers,
which is what this document used to prescribe, while `3.7` and `3.8` were both
published themed. The themed form won on the merits and is now the rule, and
`3.4`–`3.6` were retitled to match, so the releases page reads consistently from
top to bottom.

Retitling a published release is safe: its URL is keyed to the **tag**
(`/releases/tag/v3.6.15`), not the title, so existing links keep resolving. Only
the display name changes. Nothing else about a published release may be edited —
the tag it points at and its notes stay put, and once a line is released, the
next commit opens the next minor rather than adding to the published one.

## Before you push

Roll these into step 1 of [Landing the line](#landing-the-line) — each is
cheap while the branch is still local and expensive once it isn't:

- **Dependency CVE check** — see the CVE-watch routine in
  [SECURITY.md](SECURITY.md). Due monthly anyway, and again before each release.
- **New page or stylesheet?** Add it to `PRECACHE` in `sw.js`, or it will not be
  available offline on a first install.
- **Data refresh that removed regions?** Bump `CACHE` in `sw.js`. Ordinary data
  refreshes need no bump; deletions do, because a deleted file 404s on
  revalidation and the cached copy would otherwise be served forever.
  `tools/split-data.js` warns whenever it prunes a region. Full rules are under
  "Service Worker" in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Smoke-test in a browser.** The test harness is pure Node and cannot cover
  drag-and-drop, the service worker, or the rendering of either theme.
- **Diff the whole branch against `main` in one shot**
  (`git diff main...release/<minor> --stat`) — a sanity check on the minor's
  total footprint before it becomes irreversible on `main`, not just each
  commit's diff in isolation.

## What is not released

Patches are not scheduled on the roadmap — they land continuously between
releases and are recorded in the changelog. The roadmap plans feature releases
only.
