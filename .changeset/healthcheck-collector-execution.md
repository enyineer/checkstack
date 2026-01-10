---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
---

Extended health check system with per-collector assertion support.

- Added `collectors` column to `healthCheckConfigurations` schema for storing collector configs
- Updated queue-executor to run configured collectors and evaluate per-collector assertions
- Added `CollectorAssertionSchema` to healthcheck-common for assertion validation
- Results now stored with `metadata.collectors` containing per-collector result data
