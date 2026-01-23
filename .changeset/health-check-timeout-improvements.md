---
"@checkstack/backend-api": minor
"@checkstack/backend": patch
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-dns-backend": patch
"@checkstack/healthcheck-grpc-backend": patch
"@checkstack/healthcheck-http-backend": patch
"@checkstack/healthcheck-jenkins-backend": patch
"@checkstack/healthcheck-mysql-backend": patch
"@checkstack/healthcheck-ping-backend": patch
"@checkstack/healthcheck-postgres-backend": patch
"@checkstack/healthcheck-rcon-backend": patch
"@checkstack/healthcheck-redis-backend": patch
"@checkstack/healthcheck-script-backend": patch
"@checkstack/healthcheck-ssh-backend": patch
"@checkstack/healthcheck-tcp-backend": patch
"@checkstack/healthcheck-tls-backend": patch
---

## Health Check Execution Improvements

### Breaking Changes (backend-api)

- `HealthCheckStrategy.createClient()` now accepts `unknown` instead of `TConfig` due to TypeScript contravariance constraints. Implementations should use `this.config.validate(config)` to narrow the type.

### Features

- **Platform-level hard timeout**: The executor now wraps the entire health check execution (connection + all collectors) in a single timeout, ensuring checks never hang indefinitely.
- **Parallel collector execution**: Collectors now run in parallel using `Promise.allSettled()`, improving performance while ensuring all collectors complete regardless of individual failures.
- **Base strategy config schema**: All strategy configs now extend `baseStrategyConfigSchema` which provides a standardized `timeout` field with sensible defaults (30s, min 100ms).

### Fixes

- Fixed HTTP and Jenkins strategies clearing timeouts before reading the full response body.
- Simplified registry type signatures by using default type parameters.
