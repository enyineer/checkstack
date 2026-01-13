---
"@checkstack/common": minor
"@checkstack/healthcheck-common": minor
"@checkstack/backend-api": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/healthcheck-http-backend": patch
"@checkstack/healthcheck-tcp-backend": patch
"@checkstack/healthcheck-grpc-backend": patch
"@checkstack/healthcheck-mysql-backend": patch
"@checkstack/healthcheck-postgres-backend": patch
"@checkstack/healthcheck-redis-backend": patch
"@checkstack/healthcheck-ssh-backend": patch
"@checkstack/healthcheck-ping-backend": patch
"@checkstack/healthcheck-dns-backend": patch
"@checkstack/healthcheck-tls-backend": patch
"@checkstack/healthcheck-script-backend": patch
"@checkstack/healthcheck-jenkins-backend": patch
---

Enforce health result factory function usage via branded types

- Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
- Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
- Added branded `HealthResultField<T>` type to mark schemas created by factory functions
- Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
- Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
- Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error
