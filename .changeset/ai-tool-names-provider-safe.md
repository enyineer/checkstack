---
"@checkstack/ai-backend": minor
---

fix(ai): make AI tool names provider-safe (no "." in names)

LLM providers (and the MCP spec) require tool names to match
`^[a-zA-Z0-9_-]+$`, but our tool names are qualified as `<plugin>.<tool>`
(e.g. `incident.list`, `dependency.list`). The "." caused the model backend to
reject the tool list, so chat tool-calling failed after deploy.

Tool names are now normalized to a provider-safe form at the single
registration chokepoint (the tool registry) and in the projection-routing
table: the "." namespace separator is mapped to "_" (so `incident.list`
becomes `incident_list`). The registry key, the name serialized out to the
model / MCP client, and the name the model echoes back in a tool call are all
the same normalized string, so the round-trip needs no reverse lookup. Any
other illegal character is an authoring mistake and is now rejected at
registration rather than silently rewritten.

BREAKING: AI tool names exposed over the MCP `tools/list` endpoint change from
the dotted form (`incident.list`) to the underscored form (`incident_list`).
MCP clients that referenced tools by their dotted names must update to the
underscored names. (Chat was already broken by the provider rejection, so this
only changes the working MCP surface.)
