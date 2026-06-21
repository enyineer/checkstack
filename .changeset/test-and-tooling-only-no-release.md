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
- `@checkstack/e2e`: move the suite to a BOOT-ONCE model. The old harness
  (`run-all.ts`) rebooted the backend and reset the DB once PER SPEC FILE and ran
  files serially - ~24s/file of reboot overhead. The backend now boots ONCE per
  run (or per CI shard) and every spec runs in PARALLEL against that single
  shared DB. This is possible because every spec is now DATA-ISOLATED: it
  namespaces the entities it creates (unique suffix) and never asserts global /
  whole-DB state. Onboarding / "fresh install" empty-state assertions moved to a
  dedicated pristine-DB phase (`*.empty.spec.ts` in an `empty-state` Playwright
  project that the data specs depend on, so it runs first on the clean DB).
  Because specs are data-isolated, in-process retries are safe again (a retry
  just re-creates its own namespaced data), so the file-level retry runner and
  its shard helper are retired; CI shards with Playwright's native `--shard=i/N`.
  Locally the full suite now runs in ~80s (single machine) vs minutes per shard.
- The regenerated bundled docs index reflects the new anomaly-detection doc page.
