---
"@checkstack/healthcheck-frontend": patch
"@checkstack/frontend": patch
---

Fix production crash when opening health check accordion and enable sourcemaps

- Fixed TypeError in `HealthCheckLatencyChart` where recharts Tooltip content function was returning `undefined` instead of `null`, causing "can't access property 'value', o is undefined" error
- Enabled production sourcemaps in Vite config for better debugging of production errors
