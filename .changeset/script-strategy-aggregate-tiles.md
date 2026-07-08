---
"@checkstack/healthcheck-script-backend": patch
---

Fix the Script health-check aggregate tiles reading "Success Rate 0%" and "Avg
Execution Time 0ms" while the per-run charts (e.g. ~34ms) were correct, and make
Success Rate / Errors / Timeouts reflect TRANSPORT outcomes only.

The Script STRATEGY's `mergeResult` was still reading the pre-collector per-run
shape (`metadata.success` / `metadata.executionTimeMs` / `metadata.timedOut`).
In the collector-based execution model the executor no longer stores those at
the top level of a run's metadata - each collector's `success` /
`executionTimeMs` / `timedOut` (and the transport-error signal
`_collectorError`) lives under `metadata.collectors[<entryId>]`, and a
catastrophic run carries a top-level `error`. So every read returned
`undefined`, which `mergeRate` / `mergeAverage` fold into rate 0 / avg 0. The
strategy-level tile then shadowed the (correct) collector tile because the
frontend reads the top-level strategy field first.

The strategy now derives its aggregates from the run's TRANSPORT signals, in
line with every other strategy and `.claude/rules/healthcheck-collectors.md`:
Success Rate and Errors reflect only whether the probe COMPLETED, INDEPENDENT of
assertion outcomes.

- `successRate` = probe completed (no transport error).
- `errorCount` = a genuine transport failure: any collector's `_collectorError`
  is set, a timeout occurred, or the run carries a top-level `error`.
- `timeoutCount` = any collector flagged `timedOut` (a timeout also counts as a
  transport error, so it never reads as a success).
- `avgExecutionTime` = `run.latencyMs` (the run's wall-clock).

It deliberately does NOT use `run.status`, which goes `unhealthy` on an
assertion failure too and so cannot distinguish a genuine transport error from a
completed-but-asserted-failing run. An assertion failure (`_assertionFailed`)
now leaves Success Rate at 100% and Errors/Timeouts at 0 - assertion health is
surfaced separately by the per-assertion tiles. Collector semantics are
unchanged.
