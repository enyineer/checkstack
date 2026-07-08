---
"@checkstack/ai-backend": patch
---

Regenerate the AI docs index to reflect the updated
`CatalogSystemActionsSlot` contract documentation (the slot now passes
`visibleSystemIds` so per-row fillers can bulk-fetch per-system data without an
N+1) in `developer-guide/frontend/extension-points`.
