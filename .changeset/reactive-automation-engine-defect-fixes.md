---
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
---

Fix four reactive-automation-engine defects in the `wait_until` / entity-change dispatch path.

- **Lost-wakeup re-evaluate-on-registration guard (HIGH, data-loss race).** `executeWaitUntil` evaluated its condition, then committed the wait lock + wake-index rows with NO re-evaluation after arming. An `ENTITY_CHANGED` for a relevant ref landing in that arm window was routed by Stage-1 against a not-yet-visible lock, enqueued no wake job, and — for a no-timeout wait (`timeoutAt` null, skipped by the sweeper) — the run stalled permanently (silent run leak). After arming the lock the engine now re-evaluates ONCE against freshly re-enriched scope; if the condition already holds it deletes the lock (its wake-index rows cascade) and continues the run inline. Idempotent via the lock delete + the per-run advisory lock.

- **Wildcard health wake drops the changed system (MEDIUM, correctness).** `reEnrichWaitScope` resolved health only for the trigger `contextKey` + `uses_state` ids and excluded the changed ref from health resolution. A wildcard health wait (`health:*`) woken by `health:sysX` — where `sysX` was neither the contextKey nor in `uses_state` — never had `scope.health.systems[sysX]` populated, so the condition read stale/empty state and failed to resume. The changed system's concrete id is now injected into health resolution during a wildcard wake.

- **`changeId` for dispatch dedup (LOW, correctness).** The Stage-2 trigger `jobId` embedded `changed.occurredAt` (millisecond granularity), so two DISTINCT changes to the same entity within one millisecond collapsed onto one job (the second run silently dropped). `EntityChangedSchema` gains an additive, back-compatible `changeId` (generated ONCE at emit time so it travels with redeliveries of the same change); the Stage-2 jobId now uses `changed.changeId` (falling back to `occurredAt` for legacy payloads). Redeliveries of one change still dedup; two real changes stay distinct.

- **Run-originated `mutate` returns the unmasked next state (LOW, correctness).** `handle.mutate` returned the `maskForRun`-masked next state, contradicting its "returns the resulting state" contract. Masking is now confined to the emitted `ENTITY_CHANGED` payload and the `entity_transitions` rows only; `mutate` returns the unmasked, zod-validated resulting state.

BREAKING CHANGES: none. The `changeId` field is additive and optional; all changes are behavior-preserving except where they fix the defects above.
