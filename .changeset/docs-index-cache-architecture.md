---
"@checkstack/ai-backend": patch
---

docs(ai): regenerate the docs search index for the cache-system architecture updates

The `cache-system` developer-guide page now documents the shipped Redis backend
and a "Distributed caching and horizontal scale" section (why the platform
caches use the shared `CacheManager` instead of pod-local caches, and that a
horizontally-scaled deployment must select a distributed backend). Regenerated
`core/ai-backend/src/generated/docs-index.ts` so the assistant's docs search
reflects the new content.
