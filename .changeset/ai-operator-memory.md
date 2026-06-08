---
"@checkstack/ai-backend": minor
"@checkstack/ai-common": minor
"@checkstack/ai-frontend": minor
---

Add persistent "operator memory" for the AI assistant: it can save a durable
finding and recall it in later conversations, for knowledge the platform does
not otherwise store. Memories are scoped `user` (a private preference/policy) or
`system` (a fact about one system, shared with anyone who can read it), and the
model picks the scope at save time. Recall is on-demand via a `searchMemory`
tool; `saveMemory` is proposed (confirmed in chat, capped per run for the
unattended automation agent) and deduplicates by updating a near-match instead
of duplicating; `deleteMemory` is destructive (always confirmed, never offered
to the agent). Each memory carries an `alwaysInject` flag (the model proposes it,
the operator can flip it in the UI): an always-inject memory is prepended to the
system prompt every turn, so an always-apply preference (e.g. a writing-style
rule) takes effect during generation instead of waiting to be recalled. A new
`ai_memory` table backs it; `user` memories are owner-scoped and `system`
memories are gated by the same per-system team grants the catalog applies. New `ai.memory.read` / `ai.memory.manage` access rules
(default-on, admin-revocable) gate the tools. Memory content is treated as data
(never instructions), secret-scrubbed on save, and never used to cache live
state. A Memories settings page and a per-system memory card let operators view
and prune what the assistant has saved.
