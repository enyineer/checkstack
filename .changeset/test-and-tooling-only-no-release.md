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
- `@checkstack/e2e`: force-kill the ephemeral Postgres on teardown so a graceful
  stop never stalls on the last backend's leaked connections.
- The regenerated bundled docs index reflects the new anomaly-detection doc page.
