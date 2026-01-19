---
"@checkstack/common": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-http-backend": minor
---

Add ephemeral field stripping to reduce database storage for health checks

- Added `x-ephemeral` metadata flag to `HealthResultMeta` for marking fields that should not be persisted
- All health result factory functions (`healthResultString`, `healthResultNumber`, `healthResultBoolean`, `healthResultArray`, `healthResultJSONPath`) now accept `x-ephemeral`
- Added `stripEphemeralFields()` utility to remove ephemeral fields before database storage
- Integrated ephemeral field stripping into `queue-executor.ts` for all collector results
- HTTP Request collector now explicitly marks `body` as ephemeral

This significantly reduces database storage for health checks with large response bodies, while still allowing assertions to run against the full response at execution time.

