---
"@checkstack/status-page-backend": minor
---

perf(status-page): add composite index `status_page_subscribers_page_verified_idx` on (status_page_id, verified)

Serves the verified-subscriber email fan-out query
`WHERE status_page_id = ? AND verified = true`, run once per surfaced page per
incident/maintenance/health event. The existing plain
`status_page_subscribers_page_idx` on (status_page_id) left `verified` as a heap
filter; the composite index covers both predicates. The plain index is retained
(migrations are append-only).
