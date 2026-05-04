---
"@checkstack/common": minor
"@checkstack/anomaly-common": minor
"@checkstack/anomaly-backend": minor
"@checkstack/healthcheck-ping-backend": patch
"@checkstack/healthcheck-dns-backend": patch
"@checkstack/healthcheck-tls-backend": patch
"@checkstack/healthcheck-tcp-backend": patch
"@checkstack/healthcheck-http-backend": patch
"@checkstack/healthcheck-postgres-backend": patch
"@checkstack/healthcheck-mysql-backend": patch
"@checkstack/healthcheck-redis-backend": patch
"@checkstack/healthcheck-grpc-backend": patch
"@checkstack/healthcheck-rcon-backend": patch
"@checkstack/healthcheck-ssh-backend": patch
"@checkstack/healthcheck-script-backend": patch
"@checkstack/healthcheck-jenkins-backend": patch
"@checkstack/collector-hardware-backend": patch
---

Add practical-significance floors to anomaly detection.

Two new schema annotations — `x-anomaly-min-absolute-delta` and `x-anomaly-min-relative-delta` — let plugin authors and operators suppress alerts whose statistical deviation is large but practical impact is negligible. Both floors must clear in addition to the existing μ ± Nσ trigger; defaults are 0 (disabled) so existing behaviour is unchanged.

This is the fix for cases like a 6 ms latency baseline whose σ ≈ 1 ms causes routine 20 ms blips to fire as anomalies despite Δ=14 ms being operationally irrelevant. With `min-absolute-delta: 50` and `min-relative-delta: 0.5`, those blips stay silent while a 6 ms → 200 ms spike still fires.

Built-in plugins ship with sensible defaults applied to every per-run field: 50 ms + 50 % for ms-unit fields, 5 percentage points for `%`-unit fields, 1 + 25 % for counter fields, 1 GB + 5 % for disk fields, 50 MB + 10 % for memory fields, 1 day for TLS expiry, 0.5 + 25 % for load average, 1 + 5 % for Minecraft TPS. Operators can override per-system or per-field via the assignment UI.
