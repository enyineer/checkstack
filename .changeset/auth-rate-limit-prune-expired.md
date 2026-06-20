---
"@checkstack/auth-backend": minor
---

Periodically prune expired `better_auth_rate_limit` rows.

better-auth's shared-Postgres brute-force limiter only ever upserts counters, so the `better_auth_rate_limit` table grew one row per distinct `(ip, path)` key forever and nothing ever removed dead rows. auth-backend now schedules an hourly recurring queue job (cron `0 * * * *`, work-queue consumer group) that runs an idempotent `DELETE` of rows whose `lastRequest` is older than a conservative 24h TTL - far past any active limiter window, so a live counter is never removed. The sweep is exposed as `pruneExpiredBetterAuthRateLimits` for reuse and testing. No schema change (pruning is a DELETE). Pod-safe: a single consumer per fire runs the sweep, and the DELETE is shared-DB so duplicate fires are harmless.
