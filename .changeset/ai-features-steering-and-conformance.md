---
"@checkstack/ai-backend": minor
"@checkstack/ai-common": minor
---

Improve AI chat/agent steering, MCP conformance, doc grounding, and provider seams.

- Tool feedback self-correction: a validation failure or duplicate tool call now surfaces as a thrown tool error (a distinct AI-SDK `tool-error` result part) instead of an ordinary success value, so the model is told the call failed and retries. Confirm cards remain success results and carry a structured `status: "awaiting_operator"`. The headless agent runner surfaces tool failures the same way instead of returning `{ error }` as data.
- System prompts are now sectioned (clear `##` headings, blank-line separation) with the safety-critical access-scope and investigation rules near the top. The ~600-token automation-building playbook is no longer always-on: it loads only when an automation tool is in scope (or via the `automation-author` skill). Headless author overrides are wrapped in an `<author_instructions>` delimiter.
- Model-family seam: connections may declare `modelFamily` (`anthropic` | `openai` | `generic`, default `generic`). The transport stays `@ai-sdk/openai-compatible` for every value; capable families get a lighter-touch prompt-calibration note. Per-turn volatile preambles (memory/skill/summary) now follow the stable base prompt for prompt-cache friendliness on caching-capable gateways.
- MCP Streamable-HTTP conformance (spec `2025-06-18`): `tools/list` advertises `outputSchema` and `tools/call` returns `structuredContent` for tools that declare an output; `Mcp-Session-Id` is required and validated on post-initialize requests; the negotiated `protocolVersion` is echoed; cross-site `Origin` requests are refused.
- Doc grounding relevance is now a corpus-size-stable relative signal (top-hit gap to the runner-up) instead of an absolute BM25 threshold. The per-read result clamp budget derives from the connection's `contextWindowTokens` instead of a hardcoded constant.
- The topical pre-classifier round-trip can be disabled per connection (`disableTopicalClassifier`); the in-prompt off-topic decline then carries it.
- Steering de-duplication: the "when to call this / pass a UUID, not a name" trigger guidance now lives only in the tool `description` (where it travels with the tool), and the chat system prompt's investigation section keeps only cross-tool strategy and the universal id-discipline rule, so the two can no longer drift.
- Tool descriptions are now stable across permission modes: the per-mode note ("(auto-applied...)", "(requires human confirmation...)") is no longer appended to a tool's `description` at wire time. The conversation's mode is conveyed once by the system prompt's permission-mode line, keeping tool identity decoupled from conversation state.
