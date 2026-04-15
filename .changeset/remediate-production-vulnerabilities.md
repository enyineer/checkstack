---
"@checkstack/backend": patch
"@checkstack/catalog-backend": patch
"@checkstack/incident-backend": patch
"@checkstack/maintenance-backend": patch
"@checkstack/auth-backend": patch
"@checkstack/integration-backend": patch
"@checkstack/notification-backend": patch
"@checkstack/theme-backend": patch
"@checkstack/healthcheck-backend": patch
"@checkstack/auth-ldap-backend": patch
"@checkstack/healthcheck-http-backend": patch
---

Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
