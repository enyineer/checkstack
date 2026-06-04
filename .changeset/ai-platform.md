---
"@checkstack/ai-backend": minor
"@checkstack/ai-common": minor
"@checkstack/ai-frontend": minor
"@checkstack/auth-backend": minor
"@checkstack/auth-common": minor
"@checkstack/auth-frontend": minor
"@checkstack/backend-api": minor
"@checkstack/backend": minor
---

Add the AI platform: a transport-agnostic tool spine, an OAuth Authorization Server + read-only MCP server, a propose/apply flow with audit log, a streaming in-app chat agent, per-conversation permission modes, per-integration spend caps, and user-scoped tool authorization.

Two new packages, `@checkstack/ai-common` (the `AiTool` contract, `read`/`mutate`/`destructive` effect classification, the `ai.*` access rules, the OpenAI-compatible connection shape, and the wire contracts) and `@checkstack/ai-backend` (the tool registry, extension points, principal-to-tool resolver, shared zod-to-JSON-Schema serializer, and all transports). The OpenAI-compatible integration provider registers through the existing integration provider extension point, so its API key is stored in the Secrets Vault and configured in the generic Connections UI.

What ships:

- Tool spine and extension points: `aiToolExtensionPoint.registerTool` (hand-authored composite tools) and `aiToolProjectionExtensionPoint.expose` (opt-in projections of existing oRPC procedures). Authorization mirrors `autoAuthMiddleware` exactly - a tool is surfaced only when every `requiredAccessRules` entry is satisfied, so a scope-narrowed principal can only ever see fewer tools.
- OAuth + MCP: Checkstack can act as its own OAuth 2.1 Authorization Server (authorization code + PKCE, consent screen, Dynamic Client Registration) and expose a read-only MCP server over Streamable HTTP at `/api/ai/mcp`. Off by default, enabled by the admin `ai.mcp-oauth` setting. A Bearer OAuth-token branch is added to the auth strategy; token scopes are intersected live with the bound user's access rules on every call. A shared-Postgres rate limiter throttles the DCR endpoint per client IP. `getMcpOAuthSettings` / `setMcpOAuthSettings` contracts added to `@checkstack/auth-common`. A minimal OAuth consent page (`/auth/oauth-consent`) renders the requesting client and scopes.
- Propose/apply + audit: a transport-agnostic two-step service - `propose` re-checks authz, runs the tool's `dryRun` without mutating, and returns a single-use proposal token (the `proposed` audit row IS the token store, 10-minute TTL, atomic single-use); `apply` re-parses the server-stored payload, re-checks authz, and atomically commits. The `ai_tool_calls` audit table records every call across both transports with a SHA-256 args hash (never raw arguments) and stamps who proposed and who applied. An `ai.toolCalled` event carries metadata only.
- In-app chat: a server-side, provider-agnostic Vercel AI SDK agent loop (OpenAI, Azure, OpenRouter, Ollama, vLLM, LM Studio, ...). The model provider is built on the backend from the integration credentials, so the API key never leaves the backend. The loop offers only resolver-allowed tools, auto-runs read tools (re-entering the live router as the logged-in user) and routes mutating / destructive tools through propose/apply. Durable conversation persistence (`ai_conversations`, `ai_messages`, owner-scoped RPCs) plus a streaming chat UI with a confirm-card component and per-integration model picker.
- Per-conversation permission mode (Claude-Code-style approve/auto), a durable `permission_mode` column on `ai_conversations` (default `approve`). `read` always auto-runs in both modes; `mutate` inherits the mode (auto-applies server-side in `auto`, confirm-carded in `approve`); `destructive` ALWAYS requires the human `applyTool` in both modes. Security invariant (structural + tested): the mode is consulted only on the `mutate` branch, so no `(effect, mode)` pair routes a destructive tool to auto-apply.
- Per-integration LLM spend cap (optional `spendCap` = `tokenBudget` + `windowMinutes`, default OFF). Spend is tracked in a shared-Postgres `ai_spend` ledger; enforcement is a rolling-window SUM run before each turn (HTTP 429 over budget). Per-principal tool rate-limit budgets are a rolling COUNT over `ai_tool_calls`, enforced on both transports. An absent / empty / incomplete `spendCap` is treated as "no cap" rather than rejected.
- Full tool-call replay: `ai_messages.model_messages` (jsonb) persists the canonical AI-SDK `ResponseMessage[]` per turn and replays them verbatim on the next turn; legacy rows fall back to text-only replay.
- Enforced no-secret-leak scrubbing: `appendMessage` runs `scrubContent` on every write, redacting credential-shaped keys and high-confidence credential values; a canary regression test asserts injected secrets are stripped. A hardening test suite asserts no secret appears in any AI-surface DTO and that handler-side authz holds when the model misbehaves.
- Provider correctness: the chat provider uses `@ai-sdk/openai-compatible`'s `chatModel` (plain `/chat/completions`), so OpenAI-compatible gateways (OpenRouter, DeepSeek, Ollama, vLLM) no longer reject turns with `invalid_prompt`; `@ai-sdk/openai` is removed.

BREAKING CHANGES:

- The `AiTool` contract (`@checkstack/ai-common`) gained a `TRpc` type parameter, and both `dryRun` and `execute` now receive a USER-SCOPED `rpcClient` arg bound to the originating user. Every plugin procedure a tool calls re-enters the live router AS THAT USER, so handler-side authorization (access rules AND per-resource/team scope) is enforced exactly as a direct UI/RPC call - closing a prior privilege-escalation where tools captured a trusted service client at construction. A hand-authored tool MUST resolve its plugin client from this per-call arg and MUST NOT capture a trusted service client at factory scope. Tool factories that previously took `{ rpcClient }` should drop that parameter.
- `AiToolProjectionExtensionPoint.expose` no longer takes a second `pluginMetadata` argument; the owning metadata lives on `input.sourcePluginMetadata`. Callers must drop the second argument.

State and scale: conversations, messages, the audit log, proposal tokens, the rate-limit counter, and the spend ledger all live in shared Postgres, so every pod answers identically and the agent loop is resumable on any pod. The only pod-local state is the live MCP connection registry (bookkeeping, never a source of truth). Cross-pod conversation readback, the spend cap, and the tool budget are verified by env-gated two-pod integration tests.

This is a beta minor.
