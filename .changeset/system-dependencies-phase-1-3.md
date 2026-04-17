---
"@checkstack/dependency-common": minor
"@checkstack/dependency-backend": minor
"@checkstack/dependency-frontend": minor
"@checkstack/frontend": patch
---

Add System Dependencies plugin (Phase 1-3)

Introduces the system dependencies feature with three new core plugins:

- **dependency-common**: Shared Zod schemas, RPC contract, access rules, signal definitions, and routes
- **dependency-backend**: Drizzle schema, DependencyService with cycle detection, WarningEvaluationService with impact matrix, and RPC router with signal broadcasting
- **dependency-frontend**: DependencyBadge (dashboard), DependencyAlert (system details top), and DependencyEditor (system details) extension slot components

Key capabilities:
- Directional dependency edges between systems (source depends on target)
- Three impact types: informational, degraded, critical
- Transitive multi-hop warning propagation
- Cycle detection at creation time
- Health check-level dependency rules
- Per-user canvas node position persistence (server-side)
- Realtime signal-driven UI updates
