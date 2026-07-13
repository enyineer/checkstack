---
"@checkstack/logstream-backend": patch
---

Harden log-stream ingest protection durability and memory bounds under the
Phase-D worker pool:

- **Referenced-pattern protection now survives a worker reset.** The ingest
  pipeline only re-pushed a stream's healthcheck-referenced protected set when
  the set CHANGED, so a respawned worker (fresh, empty tree) or a dead worker's
  streams handed to the in-process fallback lost that protection indefinitely -
  the referenced mined patterns became evictable and re-minable under fresh
  ids. The flush executor now exposes a per-stream `protectionEpoch` that the
  worker pool bumps on respawn AND on the dead->fallback transition; the
  pipeline folds that epoch into its re-push key, so the next flush re-pushes
  the last-known set to the fresh tree WITHOUT re-resolving (the in-process
  executor is trivially epoch-0, unchanged). User-origin patterns already
  self-healed via hydration; this closes the gap for referenced mined patterns.
- **The global 50k-cluster cap is enforceable again for protected-holding
  streams.** Whole-tree eviction skips any stream holding a protected cluster,
  so a pod with many such streams grew unboundedly past `maxTotalClusters`.
  Eviction now runs in two phases: whole non-protected trees first (as before),
  then - when only protected-holding streams remain - it sheds their
  NON-protected clusters (globally least-recently-updated first) down to their
  protected cores. Protected clusters are never dropped, so the bound becomes
  `maxTotalClusters + (resident protected clusters)` and converges instead of
  growing without limit.
- **Hydration is bounded to avoid OOM on a pathological table.** Seeding a
  stream's parse tree loaded its pattern rows with no limit. It now loads the
  `HYDRATION_ROW_LIMIT` (10,000) most-recently-seen rows
  (`lastSeenAt DESC`, served by `log_patterns_stream_last_seen_idx`) and
  warn-logs on truncation; the dropped tail is the coldest patterns, which
  re-mine on their next line and converge.

Behavior for the common single-tree/in-process path is unchanged. Added
regression tests: worker respawn / dead-fallback re-push (pool + pipeline),
the global-cap bound with protected-holding streams present, the hydration
truncation warning, worker/in-process FlushPlan parity over a real Bun worker,
and the `patterns.changed` consumer's effect on classification.
