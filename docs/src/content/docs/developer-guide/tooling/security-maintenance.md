---
title: "Security maintenance"
description: "How the daily security-maintenance workflow scans for vulnerabilities, auto-remediates fixable ones into a CI-gated PR, and keeps the managed-override manifest honest."
---

Checkstack keeps its dependency graph patched through a daily, decoupled
security-maintenance pipeline rather than ad-hoc bumps on each PR. The pipeline
scans the published image and the full dependency graph, opens CI-gated pull
requests for fixes it can apply automatically, prunes overrides the graph no
longer needs, and tracks the rest in a single GitHub issue. This page is the
reference for that machinery and for the override-drift check you will hit in
PR CI.

## The daily workflow

[`security-maintenance.yml`](https://github.com/enyineer/checkstack/blob/main/.github/workflows/security-maintenance.yml)
runs at 06:00 UTC (and on `workflow_dispatch`). It is intentionally separate
from PR CI so a newly-disclosed CVE or a newly-available upstream fix surfaces
even when nobody opens a PR. The workflow has two jobs.

The `maintain` job:

1. Scans the **published image** (`ghcr.io/<owner>/checkstack:latest`) and the
   **filesystem** with Trivy at `CRITICAL,HIGH,MEDIUM`. Both scans run with
   `exit-code: 0` - the job never fails on a finding; it reports and opens
   PRs/issues instead.
2. Normalizes the two scans into one `vulns.json`
   (`[{ id, pkg, installed, fixed, sev }]`) and uploads it as an artifact for
   the `remediate` job.
3. Re-resolves every managed override with it removed (`audit:overrides:prune`)
   and opens a `chore(security): prune redundant managed overrides` PR when the
   graph no longer needs one.
4. Upserts a single tracking issue (label `security-maintenance`) listing every
   **fixable** finding, and closes it automatically once nothing is fixable.

The `remediate` job runs in its own clean checkout (so override-pruning and
auto-remediation never share a working tree) and turns the fixable findings
into a `fix(security): auto-remediate fixable vulnerabilities` PR.

> [!IMPORTANT]
> The pipeline **generates, never merges**. Every auto-PR must pass the full CI
> (typecheck, lint, test, build, and the security gate) before a human merges
> it. Version bumps can break consumers in ways unit tests do not catch, so a
> maintainer is always in the loop.

## The managed-override manifest

[`security/managed-overrides.json`](https://github.com/enyineer/checkstack/blob/main/security/managed-overrides.json)
is the registry of every `overrides`/`resolutions` entry in the root
`package.json`, split by intent:

- **`security`** - a transitive pin added to remediate a vulnerability. Each
  entry carries a `safeFloor` (the lowest version that is not vulnerable) plus
  `severity`, `advisory`, `reason`, `addedAt`, and `removeWhen`. These are
  re-resolved daily and auto-pruned once redundant, so they MUST carry a
  `safeFloor`.
- **`intentional`** - a deliberate, permanent pin (version alignment,
  singletons such as the single React instance for Module Federation). These
  are documented but NEVER auto-removed, so they only record `reason` and
  `addedAt`.

The pinned **version** is not stored in this file. It lives in `package.json`
`overrides`/`resolutions`, which is the single source of truth; the manifest
only records intent and the safe floor.

## How a fix is applied

[`scripts/remediate-vulns.ts`](https://github.com/enyineer/checkstack/blob/main/scripts/remediate-vulns.ts)
groups the findings by package and decides one remediation per package. The
invariants are deliberate:

- **Lowest in-major fix.** For each package it picks the lowest fixed version
  in the SAME major as what is installed, high enough to clear every advisory
  for that package.
- **Never an automatic major bump.** When a package's only fix is in a higher
  major, it is listed as **manual** and left for a human. This avoids the
  `@grpc/proto-loader` trap, where forcing `protobufjs` 8 breaks a consumer
  pinned to `^7`.
- **Direct dependency -> range bump.** When the package is declared in one or
  more workspace manifests, its declared range is raised to `^<target>` in
  **every** owning manifest and **every** dependency block, including
  `peerDependencies`. Bumping all declarations together keeps syncpack's
  unified version groups consistent.
- **Existing security override -> raise the override.** When the package is
  already pinned by a managed security override, the override floor is raised
  (never lowered) and the curated metadata is preserved. A package that is both
  directly declared AND security-overridden gets both: the range bump for npm
  consumers and the raised override for the image.
- **Transitive -> root override.** When the package is neither declared nor
  already overridden, it is pinned in the root `overrides`/`resolutions` and a
  fully-documented entry is added to the manifest's `security` section.
- **Intentional pin -> manual.** A package in the `intentional` section
  (react, drizzle-orm, ...) is never auto-bumped; auto-bumping would fight the
  intent, so it is routed to manual.

> [!CAUTION]
> A recorded `safeFloor` is only ever **raised**, never lowered. The remediator
> raises it to the higher of the new target and the existing floor; the
> override-drift check (below) fails CI if a pinned range ever sits below the
> recorded floor.

### Shipping the fix in a release

Editing manifests is not enough - a release has to version and publish the
affected packages (and rebuild the Docker image) for the fix to reach
operators. The remediator therefore writes a changeset at
`.changeset/auto-security-remediation.md` that bumps every publishable package
whose manifest it range-bumped. When a round touches only transitive deps (no
publishable package declares them), it falls back to bumping a single platform
package (`@checkstack/backend`) so a release still ships the image rebuild that
carries the override fixes. Per the beta never-major rule, the changeset is
always a `patch`.

## The override-drift check

[`scripts/audit-overrides.ts`](https://github.com/enyineer/checkstack/blob/main/scripts/audit-overrides.ts)
`--check` runs in PR CI (the fast drift guard). It fails when:

- a `package.json` override is **undocumented** (not in either bucket), or
  documented in **both** buckets;
- a managed entry is missing from, or mismatched between, `overrides` and
  `resolutions` (this repo mirrors them, so they must be identical);
- a security pin's range floor sits **below** its recorded `safeFloor`.

If you add or change an override and CI's `audit:overrides:check` fails, fix it
by making `package.json` and `security/managed-overrides.json` agree: add the
override to exactly one bucket of the manifest, mirror it in both `overrides`
and `resolutions`, and ensure the pinned range is at or above the `safeFloor`.

The heavier `--redundant` mode (run by the daily workflow) spins up a throwaway
git worktree per override, removes that single override, runs `bun install`,
and reads the resolved versions back from the worktree's lockfile. An override
is redundant when, without it, every resolved copy still sits at or above the
`safeFloor` (or the package left the graph entirely). `--prune` applies that
result, removing redundant security overrides from both `package.json` and the
manifest.

## Running it locally

The scripts are exposed as root `package.json` tasks. To check for override
drift exactly as PR CI does:

```bash
bun run audit:overrides:check
```

To see which overrides the graph no longer needs (the heavy re-resolution
audit; spins up worktrees and runs installs):

```bash
bun run audit:overrides:redundant
```

To plan a remediation against a Trivy findings file without changing anything,
run the remediator in dry-run mode:

```bash
bun run security:remediate path/to/vulns.json --dry-run
```

Drop `--dry-run` to apply the range bumps, override edits, changeset, and
lockfile refresh into your working tree - the same change set the daily
`remediate` job opens as a PR.

## PR-time gates: dependency graph vs container

Every PR runs two Trivy gates with disjoint responsibilities, so a finding is
reported once and each gate reproduces locally on its own.

`security_deps` scans the **whole npm dependency graph** from `bun.lock`,
including devDependencies (`TRIVY_INCLUDE_DEV_DEPS`). It runs first, does **no**
`bun install` and **no** build - Trivy parses `bun.lock` directly - and every
job that runs `bun install` on the runner `needs:` it. That ordering is the
point: a dev-dependency with a fixable CVE never executes in a job holding
`GITHUB_TOKEN` or registry credentials. Reproduce it with `bun run
audit:security`.

`security` scans the built image but is restricted to the **container layer**
(`TRIVY_PKG_TYPES=os`): OS/apk packages (alpine, openssl, bubblewrap, ...) and
the base image, which `bun.lock` does not describe. The npm graph is a strict
superset already covered by `security_deps`, so scanning language packages here
too would only double-report. Reproduce it with `bun run audit:image`. It runs
**in parallel** with `security_deps`, not gated behind it: the container layer
is independent of the npm graph, and its build is Docker-isolated with no
`GITHUB_TOKEN` in the build steps, so it is not the token-bearing surface the
installing jobs are.

Both gates apply the same policy: a finding with an **upgrade path** (a fixed
version exists) fails the build; a finding with no upstream fix yet is surfaced
as a `::warning::` annotation but does not gate, and is carried by the daily
workflow until a fix ships.

## Lock-file maintenance

Trivy only reports a vulnerability its database knows about, and for npm that
database is the GitHub Advisory Database. A CVE that is published to NVD but
has no GHSA entry yet is invisible to the scans above, so a fixable finding can
sit in `bun.lock` while PR CI stays green. Keeping resolutions fresh is the
control that does not depend on any advisory feed: if the lockfile already
holds the newest version each range permits, most CVEs are fixed before anyone
maps them to a package.

Renovate handles this. [`renovate.json`](https://github.com/enyineer/checkstack/blob/main/renovate.json)
enables `lockFileMaintenance` on a daily schedule and disables every ordinary
version-bump update type - `package.json` ranges stay hand-curated, and
transitive pins stay in `security/managed-overrides.json`. Renovate deletes
`bun.lock`, runs `bun install`, and force-pushes a single long-lived branch
(`renovate/lock-file-maintenance`), so there is at most one open PR.

> [!IMPORTANT]
> Merging that PR does not release anything. It lands a changeset; the release
> happens when you merge the resulting **Version Packages** PR.

### The supply-chain cooldown

Refreshing to "whatever the registry serves right now" would adopt a
compromised release the hour it lands. The cooldown lives in
[`bunfig.toml`](https://github.com/enyineer/checkstack/blob/main/bunfig.toml):

```toml
[install]
minimumReleaseAge = 259200 # 3 days
minimumReleaseAgeExcludes = []
```

This is the only place it can live. Renovate's own `minimumReleaseAge` does
**not** apply to lock-file maintenance - Renovate delegates to the package
manager - and unlike npm there is no `--before` flag it can pass to bun. Since
Renovate runs a bare `bun install`, bun reads `bunfig.toml` and enforces the
gate itself. `--frozen-lockfile` installs (CI, Docker) resolve nothing and are
unaffected.

> [!WARNING]
> A bun older than the release that added `minimumReleaseAge` ignores the key
> **silently**, leaving no cooldown at all. `packageManager` in the root
> `package.json` pins the version Renovate resolves; keep the two in step.

### Why the PR needs a changeset

`lockFileMaintenance` rewrites only `bun.lock`, which lives at the repo root.
The Changeset Coverage guard maps changed files to the package directory that
contains them, so a root-level file matches nothing and the PR passes with no
changeset. That is a trap: `release.yml` builds the Docker image only when
`changesets/action` published a package, and `inject-release.ts` bumps
`@checkstack/release` (which stamps the image tag) only when a changeset
exists. A lockfile-only merge would therefore publish nothing, rebuild nothing,
and never ship the refreshed resolutions.

Nothing changes for npm consumers - `bun.lock` is not published, so they
resolve each range themselves. The image is the artifact that bakes in the
lockfile, via `bun install --frozen-lockfile`.

[`renovate-changeset.yml`](https://github.com/enyineer/checkstack/blob/main/.github/workflows/renovate-changeset.yml)
closes the hole. On every `synchronize` of the Renovate branch it diffs the
lockfile against `main` and writes one fixed-name changeset, so a force-push
cannot drop it. `scripts/renovate-changeset.ts` attributes each changed package
to its **nearest workspace ancestors** - the workspace packages that directly
declare the external dependency through which it is reached:

```bash
bun run scripts/renovate-changeset.ts --base <base-lock> --head bun.lock --dry-run
```

For example `fast-uri` is reached only through `ajv`, so it is charged to the
packages declaring `ajv` rather than to the whole monorepo. Two filters keep
the set honest:

- **Private packages are excluded.** They never publish, so they cannot flip
  the `published` output that gates the image build.
- **`devDependencies`-only edges are excluded.** The image is built with
  `--production`, so a dev-only resolution change alters no shipped artifact.
  When a refresh touches only dev-only deps, no changeset is written and no
  release happens - which is the correct outcome.

## See also

- [Changesets](/checkstack/developer-guide/tooling/changesets/) - how the
  auto-remediation changeset versions and ships the fix.
- [Dependency linter](/checkstack/developer-guide/tooling/dependency-linter/) -
  the syncpack-based version-consistency check that the range bumps keep green.
