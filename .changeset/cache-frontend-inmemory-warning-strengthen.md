---
"@checkstack/cache-frontend": patch
---

Strengthen the in-memory cache warning on the Infrastructure Cache tab. The
alert now explains that the in-memory backend is per-pod, so under horizontal
scaling the hot-path platform caches (system health status and the
authenticated read path - user roles, role access rules, anonymous access) can
serve stale data on other pods until their short TTL expires, and directs
operators to a distributed backend such as Redis for any multi-instance
deployment.
