---
"@checkstack/gitops-backend": patch
"@checkstack/gitops-common": patch
"@checkstack/gitops-frontend": patch
"@checkstack/slo-backend": patch
"@checkstack/slo-frontend": patch
---

### GitOps: Fix authentication token handling

- Made `authToken` optional in `ReconcileProviderParams` and `ScraperOptions` to support unauthenticated access to public repositories
- GitHub and GitLab scrapers now conditionally set authentication headers only when a token is provided
- Sync worker now decrypts the encrypted `authToken` from the database before passing it to scrapers, fixing authentication failures caused by sending encrypted values in HTTP headers

### SLO: Fix premature Nines Club achievement unlock

- The "Nines Club" achievement now requires both ≥99.99% availability **and** a 365-day compliance streak, preventing immediate unlock on newly created SLOs with 100% default availability

### SLO: Align frontend achievement descriptions with backend criteria

- Fixed mismatched descriptions for Iron Uptime (7-day, not 30), Diamond Uptime (30-day, not 90), Clean Sheet (rolling window, not quarter), Full Coverage (3+ SLOs, not all systems in group), and Nines Club (99.99%)

### SLO: Enrich milestones with system names

- The `getRecentMilestones` endpoint now resolves human-readable system names via the Catalog API instead of returning raw system IDs
