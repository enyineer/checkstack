---
"@checkstack/ai-backend": patch
---

Regenerate the docs index for the status-pages architecture page

The status-pages developer-guide page gained a `resolveDetail` section (per-item
detail pages return the full update timeline + description) and a note on
`X-Forwarded-Host` host resolution behind an edge proxy. The checked-in docs
index that backs the AI assistant's docs search is regenerated to reflect it.
