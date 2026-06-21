---
"@checkstack/ai-backend": minor
---

Stop the assistant from exposing its internal tools as a user how-to.

Asked "how do I add a system to the catalog?", the chat assistant answered with
the internal tool name (`catalog.createSystem`) and its input JSON schema - but
the operator cannot call tools and never sees them; that is the assistant's own
mechanism, not a workflow. The chat system prompt now instructs the model that
tools are its own (not a public API), and that a how-to must be answered in
product terms (the UI, grounded in docs) and/or by offering to do it for the
operator - never by presenting tool names, tool input JSON, or parameter schemas
as steps to follow. Chat-only; the headless runner is unchanged.
