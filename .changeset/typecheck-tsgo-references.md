---
"@checkstack/tsconfig": patch
---

build: switch typecheck to tsgo with project references (~4× cold, ~200× warm)

The previous typecheck flow shelled out to `tsc --noEmit` once per workspace
package via `scripts/typecheck.ts` (concurrency=4). With 117 packages and
heavy cross-package imports, every invocation re-parsed all transitive
workspace deps from source — same files type-checked dozens of times per
run.

The new flow:

- A single `tsgo -b` invocation from the repo root, where tsgo is
  `@typescript/native-preview` (TypeScript 7 native port, currently in
  preview).
- TypeScript project references between every package's tsconfig and its
  workspace deps. Each package is now type-checked exactly once per build,
  with results cached in per-package `.tsbuildinfo`.
- `composite: true` is moved to `core/tsconfig/base.json` so all packages
  inherit it; `emitDeclarationOnly: true` + `outDir: "${configDir}/.tsbuild"`
  emit only declaration files into a gitignored per-package directory
  (Bun runs source TS directly at runtime, so the .d.ts emit is purely
  to satisfy the project-references contract).
- Package-level `typecheck` scripts changed from `tsc --noEmit` → `tsgo -b`
  so workspace `--filter` flows still work.
- `scripts/generate-tsconfig-references.ts` regenerates the references
  array on each package and the root solution `tsconfig.json`. Run via
  `bun run typecheck:references:generate` after adding/removing
  workspace deps.

### Measured impact

|                         | Before  | After  |
|-------------------------|---------|--------|
| Cold full-repo typecheck | 48s    | 12s    |
| Warm/incremental         | 48s    | 0.25s  |

### CI

- New `typecheck:references:check` step on every PR — fails fast when
  someone added a workspace dep but forgot to refresh references. Pure
  text check, <1s.
- Caches `**/.tsbuild` keyed on a strict hash of every `tsconfig.json`
  + `package.json` + `bun.lock`. Compressed cache size is ~4 MB
  (measured), so transfer overhead is sub-second; cache hit drops the
  typecheck step from ~12s to ~0.3s. The previous slow-cache experience
  in this repo was under the old per-package `tsc` layout; under
  tsgo+composite the metadata lives inside `.tsbuild/` and is much
  smaller.

### Plugin scaffolding

Plugin templates (`backend`, `frontend`, `common`) ship with
`"typecheck": "tsgo -b"` instead of `tsc --noEmit`. `bun run create`
now invokes `typecheck:references:generate` automatically so the
references graph is wired up to the new package without manual steps.

### Maintenance commands

| Script | When to run |
|---|---|
| `bun run typecheck` | Always; default workflow |
| `bun run typecheck:references:generate` | After adding/removing a `@checkstack/*` workspace dep, or adding a new package (auto-run by `create`) |
| `bun run typecheck:references:check` | Dry-run; CI uses this |
| `bun run typecheck:clean` | Rare — diagnosing stale cache, post-major-upgrade |

`typecheck` does not auto-run the generator (would mutate tsconfigs
silently) or the cleaner (would defeat the warm cache). The
`:check` step in CI catches drift instead.

### Operational notes

- The shared `core/tsconfig/vite-env.d.ts` declares minimal Vite types
  (`ImportMeta.env`, `import.meta.glob`, CSS side-effect imports). It's
  pulled into every frontend package via `files` in
  `core/tsconfig/frontend.json` so we don't have to depend on `vite`
  workspace-wide.
- Three real production-dep cycles in the package graph
  (`backend-api ↔ cache-api`, `backend-api ↔ queue-api`,
  `healthcheck-backend ↔ satellite-backend`) are pruned in the generator
  to keep the references graph acyclic. Affected packages still typecheck
  correctly via TS source-file resolution; the lost optimization is that
  those cycles re-parse together rather than being cached separately.
