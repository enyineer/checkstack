---
"@checkstack/ai-backend": patch
---

Regenerate the assistant's docs index to cover the new "Realtime signals: scope
to a resource when a signal is high-frequency" section of the query-invalidation
developer guide: declaring a signal `resourceKey`, registering resource-scoped
signals on a frontend plugin, how a query is matched (input-keyed detail queries
vs the `signalScopeMeta` opt-in for resource-agnostic lists), per-resource
coalescing, and why foreign signals stay blanket.
