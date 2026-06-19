---
"@checkstack/anomaly-backend": patch
"@checkstack/auth-backend": patch
"@checkstack/backend": patch
"@checkstack/backend-api": patch
"@checkstack/catalog-backend": patch
"@checkstack/healthcheck-backend": patch
"@checkstack/notification-smtp-backend": patch
"@checkstack/queue-backend": patch
---

Security: auto-remediated fixable vulnerabilities flagged by the daily scan.

- `hono` 4.12.23 → 4.12.25 (CVE-2026-54286, CVE-2026-54287, CVE-2026-54288, CVE-2026-54289, CVE-2026-54290)
- `nodemailer` 9.0.0 → 9.0.1 (GHSA-p6gq-j5cr-w38f)
- `dompurify` 3.4.3 → 3.4.11 (CVE-2026-49458, CVE-2026-49459, CVE-2026-49978, GHSA-76mc-f452-cxcm, GHSA-cmwh-pvxp-8882)
- `protobufjs` 7.5.8 → 7.6.3 (CVE-2026-48712, CVE-2026-54269)
- `undici` 7.24.7 → 7.28.0 (CVE-2026-9678, CVE-2026-9697)
