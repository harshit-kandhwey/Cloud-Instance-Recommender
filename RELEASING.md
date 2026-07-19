# Releasing

How a change gets from a working tree to a published release. The app is a
static site with no build step, so "releasing" is really two things: keeping the
version record honest, and knowing the few cases where the service worker needs
a nudge.

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

So every commit on `main` gets a version, a changelog row, and an annotated tag.

## Landing a commit

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

2. **Update the version map** at the top of [CHANGELOG.md](CHANGELOG.md):
   - Replace `_this commit_` in the previous top row with that commit's real
     short SHA (`git rev-parse --short HEAD`).
   - Add a new top row for the change you are about to commit, with
     `_this commit_` as its SHA and a sentence describing what the change does —
     written for a reader, not a diff.

   A commit cannot contain its own hash, which is why the tip row always carries
   the placeholder and the next commit backfills it. Exactly one row should ever
   say `_this commit_`.

3. **Commit and tag:**

   ```bash
   git commit -m "..."
   git tag -a v<next-version> -m "<next-version> — short description"
   ```

4. **Push and release at the end of the line, not as you go.** Commits and tags
   accumulate locally while a minor is open. When every item in the minor is
   closed — its features, its review rounds, and its fixes — push once and
   publish once:

   ```bash
   git push origin main --tags
   ```

## Cutting a minor release

Releases are published per **minor line**, not per commit — a `3.6` release, not
fifteen `3.6.x` releases.

**Publish only once the line is closed.** A release points at one tag and
nothing moves it afterwards, so a release cut while its line is still open goes
stale the moment the next patch lands: it keeps advertising a fraction of the
work, and readers of the releases page never see the rest. (This is not
hypothetical — `3.5` was published at `v3.5.10`, ran on to `v3.5.26`, and spent
a day claiming sixteen fewer commits than it shipped.)

Closing a line means, in its final commit: set the end date on the minor's
version-map heading, and write its section under **Release notes**. Then publish
its highest tag, with the notes drawn from that section:

```bash
gh release create <highest-tag-of-the-line> --verify-tag \
  --title "3.8 — Results, visualization & reporting" \
  --notes-file <notes>   # the minor's story, from its changelog section

# --latest ONLY when this is the newest line. It is not a formality: passing it
# while publishing, say, a late 3.6 patch would move "Latest" backwards off 3.7,
# and the releases page would recommend the older line to everyone.
```

**Title the release `<minor> — <theme>`** — the same theme the minor carries in
the roadmap and in its version-map heading, em dash included (for example
`3.8 — Results, visualization & reporting`). The releases page is a list of bare
numbers otherwise, and a reader deciding whether an upgrade matters to them
should not have to open each one to find out what it was about.

This settles a drift: earlier lines (`3.4`–`3.6`) were published as bare numbers,
which is what this document used to prescribe, while `3.7` and `3.8` were both
published themed. The themed form won on the merits and is now the rule. The
older releases are left as they are — retitling a published release changes what
people already hold links to, for no benefit.

The tag must already be on `origin` — `--verify-tag` will refuse otherwise.

## Before you publish

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

## What is not released

Patches are not scheduled on the roadmap — they land continuously between
releases and are recorded in the changelog. The roadmap plans feature releases
only.
