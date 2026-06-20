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
- `@checkstack/e2e`: make every serial spec retry-safe via FILE-level retries.
  The e2e DB resets per file boot, not per Playwright retry, so an in-process
  retry of a serial group re-ran its empty-state + create chain against the
  previous attempt's polluted DB and failed. `run-all.ts` now retries a failed
  spec by re-running the whole `playwright test <file>` invocation (Playwright
  retries set to 0), which re-boots the backend and resets the DB, so each
  attempt starts clean - no per-spec workarounds needed. (CI also shards the
  suite across runners and shares a single frontend/docs build; those are
  workflow-only changes.)
- The regenerated bundled docs index reflects the new anomaly-detection doc page.
