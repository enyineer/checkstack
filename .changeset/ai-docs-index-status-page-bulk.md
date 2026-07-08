---
"@checkstack/ai-backend": patch
---

Regenerate the AI docs index to reflect the new "Resolve in bulk, never per
item" guidance in `developer-guide/architecture/status-pages`, which documents
the status-page bulk-by-id endpoints (`getBulkRunStats`,
`getBulkIncidentUpdates`, `getBulkMaintenanceUpdates`) resolvers use to avoid
N+1 RPC fan-outs.
