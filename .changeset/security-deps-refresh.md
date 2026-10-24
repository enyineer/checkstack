---
"@checkstack/anomaly-backend": patch
"@checkstack/auth-backend": patch
"@checkstack/backend": patch
"@checkstack/backend-api": patch
"@checkstack/catalog-backend": patch
"@checkstack/healthcheck-backend": patch
"@checkstack/notification-smtp-backend": patch
"@checkstack/queue-backend": patch
"@checkstack/ui": patch
---

Security: remediate all fixable vulnerabilities flagged by the daily scan (#519).

Lock-file refresh within existing curated ranges clears most findings (vite, undici, sharp, dompurify, fast-uri, brace-expansion, smol-toml, source-map-js, postcss-selector-parser, shell-quote, handlebars, @grpc/grpc-js, hono, storybook, sanitize-html). One curated range change: `nodemailer` 9 → 10 in `@checkstack/notification-smtp-backend` (all fixes for its 5 advisories live on the 10.x line; the plugin only uses `createTransport`/`Transporter`, verified against 10.1.7). Range floors re-pinned to the resolved minimums by `bun update -r`. Trivy fs scan now reports zero fixable findings.
