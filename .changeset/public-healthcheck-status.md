---
"@checkmate/healthcheck-common": minor
---

Add `healthcheck.status.read` permission for public access to health status

- Added new `healthCheckStatusRead` permission with `isPublicDefault: true` and `isAuthenticatedDefault: true`
- Updated `getSystemHealthStatus`, `getSystemHealthOverview`, and `getHistory` endpoints to use `userType: "public"` with the new permission
- Anonymous and authenticated users can now view health check status and history
- Configuration endpoints remain restricted to users with `healthcheck.read` permission
