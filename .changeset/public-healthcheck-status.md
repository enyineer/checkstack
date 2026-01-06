---
"@checkmate-monitor/healthcheck-common": minor
"@checkmate-monitor/healthcheck-backend": minor
"@checkmate-monitor/healthcheck-frontend": minor
---

Add public health status access and detailed history for admins

**Permission changes:**
- Added `healthcheck.status.read` permission with `isPublicDefault: true` for anonymous access
- `getSystemHealthStatus`, `getSystemHealthOverview`, and `getHistory` now public
- `getHistory` no longer returns `result` field (security)

**New features:**
- Added `getDetailedHistory` endpoint with `healthcheck.manage` permission
- New `/healthcheck/history` page showing paginated run history with expandable result JSON
