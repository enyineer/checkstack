---
"@checkstack/ai-backend": patch
---

Regenerate the in-app docs search index for the contract-derived access-gating docs.

The bundled docs index (`generated/docs-index.ts`) is regenerated so the rewritten
`developer-guide/frontend/access-gating` page and the updated
`developer-guide/backend/teams` reference (now recommending the gate-fused
`useGatedMutation` / `useProcedureAccess` / `useSurfaceAccess` hooks instead of the
removed `useCanCreate`) are searchable by the in-app AI assistant. Generated content
only; no code behavior change.
