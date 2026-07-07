---
"@checkstack/ai-backend": patch
---

Regenerate the in-app docs search index for the environment fan-out UI docs.

The bundled docs index (`generated/docs-index.ts`) is regenerated so the updated
"Monitor a service across staging and production" guide (per-(check, environment)
overview rows, the last-healthy stamp, the environment-slice "X of Y checks
failing" count, and the deduplicated per-environment notification) and the
Notifications concept page (no duplicate rollup notification for fanned-out
systems) are searchable by the in-app AI assistant. Generated content only; no
code behavior change.
