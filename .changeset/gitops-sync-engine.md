---
"@checkstack/gitops-backend": minor
---

Add GitOps discovery and sync engine (Phase 2)

- YAML document parser with multi-document support and SHA-256 content hashing for diff detection
- GitHub scraper: org/user repo enumeration, single-repo mode, default branch resolution, recursive Git Trees API, minimatch path filtering, Link header pagination
- GitLab scraper: group project enumeration (including subgroups), single-project mode, recursive tree walking, minimatch filtering, x-next-page pagination
- Configurable `baseUrl` per provider for GitHub Enterprise and self-managed GitLab instances
- Reconciliation orchestrator: scrape → parse → validate → resolve secrets → reconcile (base + extensions) → provenance tracking → orphan detection
- Sync worker: recurring queue jobs per provider, one-off manual trigger via triggerSync RPC
- Per-entity error isolation ensures individual failures don't halt the sync
