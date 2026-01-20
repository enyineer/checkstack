---
"@checkstack/healthcheck-frontend": patch
---

### Fix layout shift in paginated tables

- Preserve previous table data during loading to prevent layout shift
- Add inline loading spinner in table headers without affecting layout
- Add opacity to table rows during loading to indicate data refresh
