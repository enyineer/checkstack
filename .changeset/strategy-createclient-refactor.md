---
"@checkstack/healthcheck-dns-backend": minor
"@checkstack/healthcheck-grpc-backend": minor
"@checkstack/healthcheck-http-backend": minor
"@checkstack/healthcheck-mysql-backend": minor
"@checkstack/healthcheck-ping-backend": minor
"@checkstack/healthcheck-postgres-backend": minor
"@checkstack/healthcheck-redis-backend": minor
"@checkstack/healthcheck-script-backend": minor
"@checkstack/healthcheck-ssh-backend": minor
"@checkstack/healthcheck-tcp-backend": minor
"@checkstack/healthcheck-tls-backend": minor
"@checkstack/healthcheck-ssh-common": minor
---

Refactored health check strategies to use `createClient()` pattern with built-in collectors.

**Strategy Changes:**
- Replaced `execute()` with `createClient()` that returns a transport client
- Strategy configs now only contain connection parameters
- Collector configs handle what to do with the connection

**Built-in Collectors Added:**
- DNS: `LookupCollector` for hostname resolution
- gRPC: `HealthCollector` for gRPC health protocol
- HTTP: `RequestCollector` for HTTP requests
- MySQL: `QueryCollector` for database queries
- Ping: `PingCollector` for ICMP ping
- Postgres: `QueryCollector` for database queries
- Redis: `CommandCollector` for Redis commands
- Script: `ExecuteCollector` for script execution
- SSH: `CommandCollector` for SSH commands
- TCP: `BannerCollector` for TCP banner grabbing
- TLS: `CertificateCollector` for certificate inspection
