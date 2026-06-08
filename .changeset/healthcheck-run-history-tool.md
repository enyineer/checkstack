---
"@checkstack/healthcheck-backend": minor
---

Add a `healthcheck.runHistory` AI tool so the assistant can answer timeline and
root-cause questions ("what issues did system X have between T1 and T2", "show
the unhealthy runs in the last hour"). It projects the existing filtered
`getHistory` query, exposing the `systemId`, `startDate`/`endDate`, and
`statusFilter` filters, and is gated by the same public, default-on
`healthcheck.status` view rule the dashboard history view uses (no extra grant
needed). It complements `healthcheck.status`, which only reports current state.
