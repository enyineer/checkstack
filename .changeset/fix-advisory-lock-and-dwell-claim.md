---
"@checkstack/backend-api": minor
"@checkstack/automation-backend": minor
"@checkstack/script-packages-backend": minor
"@checkstack/script-packages-common": minor
"@checkstack/incident-backend": minor
---

Fix several correctness defects around distributed coordination and stored-data handling.

- Dwell `for:` timers now fire via an atomic `DELETE ... RETURNING` claim, so two pods (or the stalled sweeper vs the queue consumer) can no longer both fire the same dwell.
- Postgres session-level advisory locks now keep connection affinity. A shared `AdvisoryLockService` (backed by a dedicated pooled client) replaces the previous acquire/release-on-different-connection pattern that leaked locks. Used by the script-packages installer election, the automation run resume + stalled sweeper, and (via a new transaction-scoped `withXactLock`) incident dedup.
- A storage migration that crashed mid-flight is now resumed on startup under the installer-election lock, instead of permanently wedging installs.
- Distributed script-package blobs carry a `blobSha256` and are verified before extraction (the SRI `integrity` hashes the npm tarball, not the transported archive). Backward-safe: entries without the field skip verification until a re-install regenerates the manifest.
- Archive extraction rejects zip-slip paths (absolute or `..` entries) before writing anything.
- `incident.create` with `dedupe_open_for_system` serializes its check-then-create per system, so concurrent triggers for the same system can't both open a duplicate incident.
- Seeded auto-incident filter expressions JSON-encode interpolated ids so a quote/backslash can't corrupt the expression.
- Stored jsonb snapshots (dwell `actorSnapshot`, wait-lock `waitConfig`) are validated with zod on load and degrade safely instead of flowing through as the wrong type.
