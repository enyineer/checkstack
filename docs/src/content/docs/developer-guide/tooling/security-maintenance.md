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

## See also

- [Changesets](/checkstack/developer-guide/tooling/changesets/) - how the
  auto-remediation changeset versions and ships the fix.
- [Dependency linter](/checkstack/developer-guide/tooling/dependency-linter/) -
  the syncpack-based version-consistency check that the range bumps keep green.
