---
---

Test- and tooling-only changes that intentionally carry no package release
(per `.claude/rules/changesets.md`):

- `@checkstack/slo-backend`: export `runWeeklyDigest` for direct unit testing
  plus added cache / streak / weekly-digest / service tests. No behavior change.
- `@checkstack/test-utils-backend`: add a real-Postgres test-DB helper
  (`with-test-db.ts`) for `*.it.test.ts` query-correctness tests.
- `@checkstack/queue-memory-backend`: benchmark-script comment + recurring-jobs
  test updates.
- `@checkstack/auth-backend`: isolate the rate-limit-prune integration test from
  rows other tests in its shared schema leave behind (test fix, not a code fix).
- `@checkstack/e2e`: fix the teardown hang at "stopping ephemeral Postgres...".
  Root cause: Testcontainers' Ryuk reaper keeps a persistent socket to its
  sidecar open for the process lifetime and relies on `socket.unref()` to not
  block exit, but the Bun runtime does not honor that `unref`, so the process
  never exits after the suite finishes (in CI the step pipes through `tee`, which
  only ends when our stdout closes - hence the indefinite hang). Disable Ryuk in
  the harness: the wrapper already stops and removes the container deterministically
  in `finally` on every exit path, and CI runners are ephemeral, so the reaper is
  unnecessary. Also keep the 0s-grace force-kill so the stop itself is immediate.
- `@checkstack/e2e`: make the catalog spec retry-safe. The serial group retried
  from the top against a DB reset only per file boot (not per retry), so a flake
  in any later test re-ran the global empty-state assertions against an
  already-populated catalog and hard-failed. Split the read-only empty-state
  tests into `catalog-empty.spec.ts` (its own fresh, never-mutated DB), and key
  the mutating chain's created names to the retry attempt (`-r<n>`) so a retry
  never collides with the previous attempt's leftover rows.
- `@checkstack/e2e`: speed up per-spec DB resets with a Postgres TEMPLATE
  database. `with-e2e-postgres.ts` builds a fully-migrated template ONCE at the
  start (by booting the real backend against an empty DB - the exact production
  migration path, so it is generated from the current schema every run and can
  never drift; no checked-in dump). Each per-file reset then clones it via
  `CREATE DATABASE ... TEMPLATE` (a file copy), so the backend's boot-time
  migrations become a no-op instead of re-running ~100+ migrations across ~25
  plugin schemas every boot. Falls back to empty-create + migrate when no
  template exists (e.g. `test:e2e:file` run directly).
- The regenerated bundled docs index reflects the new anomaly-detection doc page.
