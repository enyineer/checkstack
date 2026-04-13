---
"@checkstack/auth-backend": patch
"@checkstack/auth-common": patch
"@checkstack/backend-api": patch
"@checkstack/backend": patch
"@checkstack/common": patch
"@checkstack/theme-backend": patch
"@checkstack/notification-backend": patch
"@checkstack/integration-backend": patch
"@checkstack/healthcheck-ping-backend": patch
"@checkstack/collector-hardware-backend": patch
"@checkstack/healthcheck-script-backend": patch
---

Security Vulnerability Remediation completed:
- Refactored core authorization to Fail-Closed architecture with secure defaults.
- Implemented `assertTeamManagementAccess` to resolve BOLA in Teams Management.
- Protected internal S2S capabilities via explicit wildcard `serviceScope` definitions.
- Disarmed OS Command Injection in DiskCollector via strict regex validation and bash escaping.
- Re-architected inline script processing executing scripts in sandboxed Web Worker contexts.
- Isolated subprocess environment scopes in PingStrategy limiting variable leakage.
- Enforced strict token/API Key parsing with URLSearchParams checking.
- Explicitly fail-fast on missing DATABASE_URL configuration across independent backend clusters.
- Activated strict HTTP Security Headers (HSTS, CSP, X-Frame-Options) across the API automatically.
