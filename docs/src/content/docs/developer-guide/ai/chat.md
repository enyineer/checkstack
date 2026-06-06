---
title: Internal chat
description: The server-side, provider-agnostic agent loop that powers the in-app AI assistant, with conversation persistence, confirm cards, and per-integration model selection.
---

The in-app AI assistant is a server-side agent loop built on the Vercel AI SDK. It runs entirely on the backend, uses the same tool registry as the MCP server, persists conversations in shared Postgres, and never lets the model silently change state. Read tools auto-run; mutating and destructive tools surface a confirm card that a human must approve.

## The agent loop runs on the backend

The chat turn is a raw HTTP handler at `/api/ai/chat` (server-sent events, because streaming needs a raw handler). The handler authenticates the request through the platform auth strategy, requires a logged-in real user (applications and services use MCP, not chat), and hands the turn to the agent loop. The model provider is created on the backend from the selected integration's credentials, so the API key never crosses to the browser. The browser only ever receives streamed tokens and tool events.

```ts
// Provider-agnostic via base-URL override (OpenAI, Azure, OpenRouter, Ollama, ...).
const model = buildLanguageModel({ connection, model: conversation.model });
const result = streamText({ model, system, messages, tools, stopWhen: stepCountIs(8) });
return result.toUIMessageStreamResponse();
```

## Tools come from the same registry

The loop offers the model exactly the tools the resolver allows for the logged-in principal, no more. The model is treated as an untrusted caller: it picks arguments, but it can never reach a tool the principal cannot use, and every tool call is gated server-side.

- `read` tools auto-run. Their execution re-enters the live router as the logged-in user (the chat request's own auth is forwarded), so handler-side authorization runs exactly as for any other caller. Each successful read writes an `ai_tool_calls` row with `transport: "chat"` (and an args hash, never the raw args), so chat reads appear in the audit log AND count toward the per-principal rate-limit budget, exactly like MCP reads.
- `mutate` and `destructive` tools never run inline. Their executor runs the `propose` dry-run and returns a confirm card carrying the single-use proposal token and the validated payload. Nothing is committed until the operator clicks Apply, which calls `applyTool` with the token.

```ts
// Disposition of a model-requested tool (the single server-side gate):
disposeAgentTool({ toolName, principal, resolver, getTool });
// -> { kind: "run" } | { kind: "confirm" } | { kind: "refused" }
```

The same per-principal rate-limit budget that protects MCP is enforced before every tool call in the loop. See [Propose and apply](/checkstack/developer-guide/ai/propose-apply/) for the budget and the confirm-card token lifecycle.

## The model acknowledges a confirm-card decision

A confirm card ends the model's turn: the model has said what it will do and is now waiting on the operator. When the operator clicks Apply (or Decline), the actual apply still runs through the unchanged `applyTool` propose/apply path, and then a short follow-up turn makes the model react so the conversation does not dead-end on "waiting for your confirmation".

That follow-up is a second mode of the same `/api/ai/chat` handler. Instead of a `message`, the POST body carries a `decision` (the proposal token plus `apply` or `decline`); the handler routes it to `streamDecision`, which streams the model's acknowledgment over the same SSE path as a normal turn.

```ts
// POST /api/ai/chat — a normal turn OR a confirm-card decision turn:
{ conversationId, connectionId, model?, message: "..." }                 // user turn
{ conversationId, connectionId, model?, decision: { token, kind } }       // apply | decline
```

The decision note handed to the model is derived SERVER-SIDE from the stored proposal (its tool name and the one-line summary captured at propose time), so no client-supplied text ever reaches the model. The note is EPHEMERAL: it is appended to that turn's history only and never persisted; the assistant's streamed reply is what gets saved, and it carries the outcome forward so later turns know the change is live. `streamDecision` re-checks ownership, that the proposal belongs to THIS conversation, and — for an `apply` — that the proposal is actually in the `applied` state (the apply ran first), refusing with a 409 otherwise so the model can never falsely claim a change took effect.

```ts
proposeApply.describeProposal({ token }); // read-only: tool name, summary, status, conversation (no consume)
buildDecisionNote({ decision, toolName, summary }); // the ephemeral, server-derived note
```

## Conversations are durable and pod-independent

Conversations and messages live in `ai_conversations` and `ai_messages` in shared Postgres. The user message is persisted before streaming begins, and the assistant message on completion, so a mid-stream pod restart still leaves a complete, resumable transcript. Any pod can list, open, or continue a chat; nothing about a conversation is pod-local. All reads are owner-scoped, so a user can only ever see their own conversations.

When a turn is resumed, the model must see its prior TOOL interactions, not just the text it eventually said. On completion the loop persists the canonical AI-SDK `ResponseMessage[]` for the turn (assistant tool-call parts plus tool-result parts) into the additive `ai_messages.model_messages` column. On the next turn `toModelMessages` replays those messages verbatim, so a multi-turn conversation reconstructs the full tool-call history for the model. Rows written before this column existed (or plain user/system rows) fall back to text-only replay. Because the replay history lives in shared Postgres, replay is identical on whichever pod handles the next turn.

The conversation contract (RPC):

```ts
ai.listChatIntegrations(); // selectable providers + model UX (no secrets)
ai.listConversations();    // the user's conversations, newest first
ai.createConversation({ integrationId, model });
ai.getConversation({ id }); // conversation + full transcript
ai.updateConversation({ id, title, model });
ai.archiveConversation({ id }); // soft delete: the user-facing "Delete" action
ai.deleteConversation({ id }); // hard delete (cascades); not the user action
```

## Deleting a chat is a soft archive

The user-facing "Delete" action in the sidebar does NOT remove the row. It calls `archiveConversation`, which stamps an `archived_at` timestamp on the `ai_conversations` row. `listConversations` filters `archived_at IS NULL`, so an archived chat disappears from the sidebar, but the conversation and its messages are RETAINED in Postgres for later abuse introspection. The archive is owner-scoped, so a user can only archive their own chats, and a repeat archive of an already-archived row is a no-op.

The frontend confirms the action through a modal (labeled "Delete"), then archives, lets the owning plugin's query invalidation refresh the list, and clears the view back to the empty state if the archived chat was the open one. The hard `deleteConversation` method is retained for non-user callers (such as a retention sweep) but is never wired to the sidebar, so nothing the user clicks ever hard-deletes a transcript.

```ts
archiveConversation({ id, userId }); // stamps archived_at = now, owner-scoped
// listConversations filters archived_at IS NULL
```

## Starting a new chat

The "New chat" button creates a fresh conversation, makes it the active (highlighted) one, and clears the message view. Because `createConversation` is an oRPC mutation, it auto-invalidates the plugin's conversation list on success, so the new chat appears in the sidebar immediately. To avoid spawning a pile of empty "Untitled chat" rows, the click is deduplicated: if the conversation already open is itself an empty untitled draft (no title and no messages), the button reuses it instead of creating another row. The decision is a pure helper so it is unit-testable without rendering the page.

```ts
decideNewChatAction({ current, messages }); // -> { kind: "reuse" } | { kind: "create" }
```

## Conversations are auto-titled

A new conversation starts untitled, so the sidebar would otherwise show "Untitled chat". After the first user message of a still-untitled conversation, the backend derives a concise title (at most six words, no quotes, markdown, or trailing punctuation) and persists it with `updateConversation({ title })`. The title is produced by a cheap `generateText` call that reuses the turn's resolved connection and model, then sanitized with `sanitizeGeneratedTitle`.

Titling is fire-and-forget: it runs detached from the streamed turn, so it never delays or crashes the response. On any model or sanitize failure it falls back to a deterministic heuristic from the first message (`deriveHeuristicTitle`: collapse whitespace, first six words, capped at sixty characters). The title lives in the shared `ai_conversations` table, so it is readable on every pod. The chat page invalidates the conversation list when a turn completes to pick up the new title, because the streaming turn is a raw SSE fetch rather than an oRPC mutation and so does not auto-invalidate.

```ts
deriveHeuristicTitle(firstMessage); // fallback when the model errors
sanitizeGeneratedTitle(raw);        // strip quotes/markdown/punctuation, cap length
```

## Per-integration model selection

Model choice is a property of the credential and provider, so it lives on the OpenAI-compatible integration connection: `defaultModel` is required and `availableModels` is an optional allowlist. The chat model picker always renders a `Select` whose options are `[defaultModel, ...availableModels]`, de-duplicated with the default first, so the connection's own default is always selectable. With no `availableModels` the picker contains just the default; it is never a free-text field. The model id is untrusted wire input, so it is revalidated server-side at two points: `createConversation` / `updateConversation` coerce a stored model against the integration's allowlist, and `buildLanguageModel` always runs the requested (or stored) model id through `resolveModelId` before handing it to the provider, so an out-of-allowlist id is coerced to `defaultModel` and never reaches the provider. An empty allowlist allows any model from the picker's default (free-text providers like Ollama still configure a `defaultModel`).

```ts
resolveModelId({ connection, requested }); // requested, or defaultModel if out of allowlist
```

## Off-topic guard

The assistant helps with operating Checkstack (incidents, health checks, anomalies, automations, monitoring, and on-call) AND with questions about the assistant itself or how to use Checkstack. Two layers keep clearly unrelated requests (general coding help, creative writing, general trivia) from spending tokens on the expensive tool loop.

First, the system prompt instructs the assistant to decline clearly unrelated requests with a one-line redirect, so even a request that slips past the classifier is steered back.

Second, a cheap topical pre-classifier runs BEFORE the agent/tool loop. It is a small `generateText` call (injectable like the title generator, defaulting to the turn's resolved model) with a tight prompt that returns a single token: `ON_TOPIC` or `OFF_TOPIC`. The following are always `ON_TOPIC`:

- Checkstack operations: incidents, health checks, anomalies, automations, monitoring, on-call, the platform's data and configuration.
- Meta/capability questions about the assistant itself: "what can you do?", "who are you?", "help", "what features do you have?".
- Greetings and conversational openers: "hi", "hello", "hey".
- How-to and conceptual questions about using Checkstack features or workflows: "how do health checks work?", "how do I create an automation?".

Only CLEARLY unrelated requests are `OFF_TOPIC`: general coding help unrelated to Checkstack, creative writing, and general trivia or knowledge questions.

The reply is parsed by a pure function that leans toward `ON_TOPIC` on anything ambiguous or unrecognized, because a false refusal of a real ops question is worse than letting one off-topic request slide.

- On `OFF_TOPIC` the turn short-circuits: the expensive tool loop never runs. A canned, concise refusal is streamed back over the same SSE path the normal turn uses (so the frontend renders it identically) and persisted as the assistant message. The refusal nudges the user toward supported topics rather than just declining.
- The classifier is fail-open: if the classifier model call throws, the turn proceeds normally. A classifier hiccup must never block legitimate use.
- The classifier's own small token usage is recorded against the shared `ai_spend` ledger, exactly like any other model call, so it is accounted toward the spend cap.

```ts
buildClassifierPrompt({ userText });   // { system, prompt } for the cheap call
parseClassifierVerdict(raw);           // "ON_TOPIC" | "OFF_TOPIC" (ambiguous -> ON_TOPIC)
```

## Per-integration LLM spend cap

Each OpenAI-compatible connection may carry an optional `spendCap`. It is OFF by default: no cap is enforced unless you configure one in the connection's settings form. The cap is a token-count budget, not a USD budget, because token counts are deterministic and provider-agnostic. Every OpenAI-compatible provider (OpenAI, Azure, OpenRouter, Ollama, vLLM, LM Studio) reports token usage through the AI SDK, but only some publish a price table and self-hosted models have none, so a USD cap would need a per-model pricing table that drifts and is meaningless for local models.

```ts
spendCap: { tokenBudget: 200000, windowMinutes: 60 } // optional; omit for no cap
```

When a cap is set, the loop refuses a new turn once the principal's token usage against that integration in the trailing `windowMinutes` reaches `tokenBudget`, returning a clear spend-exceeded error (HTTP 429). Spend is a rolling-window SUM over the shared `ai_spend` ledger: every completed turn appends one row with the AI SDK's reported input and output tokens, keyed by integration and principal. Because the sum is read from the same shared table every pod writes to, the cap holds across all pods, exactly like the per-principal tool rate-limit budget. An in-memory per-pod token counter would let N pods each allow the cap, which a single-process test could never catch, so the ledger is durable Postgres and the cross-pod count is verified in `core/ai-backend/src/rate-limit/spend-ledger.it.test.ts`.

## Dates and timezones

The model produces dates as text, so the chat enforces an unambiguous wire contract: every date-time a tool receives must be RFC 3339 with an EXPLICIT timezone offset (`2026-07-01T22:00:00Z` or `2026-07-01T22:00:00+02:00`). Zone-less values (`2026-07-01T22:00:00`) and date-only values (`2026-07-01`) are rejected, because feeding a zone-less string to `new Date()` would interpret it in the pod's local zone and the same string could then resolve to different instants on different pods. A rejected value comes back to the model as a tool-input error naming the field and the requirement, so the model repairs the call itself. The contract is enforced centrally for every tool input and structured output, gated to date fields, in `core/ai-backend/src/chat/model-schema.ts`.

To turn an operator's bare "22:00" into an offset, the model needs a reference timezone. The browser sends its IANA zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) with every turn, and that zone is folded into the system prompt. So by default each operator's times are interpreted in their own browser timezone, with no configuration.

When no browser zone is available (a headless automation "AI Action", or a client without `Intl`), the reference zone falls back to the host/container timezone, NOT to UTC. Operators override it by setting the container's `TZ`:

```env
# Reference timezone for AI date interpretation when no browser zone is sent
# (e.g. automation AI Actions). Any IANA zone id.
TZ=Europe/Berlin
```

This only affects how a bare time is interpreted into an offset; storage is always an absolute instant. The regular (non-AI) UI is unaffected: its date pickers produce real `Date` objects, which serialize as absolute instants and render back in each viewer's own browser zone.

## No secret leaves the backend

The integration API key is stored in the Secrets Vault and read only on the backend when building the model provider. The chat RPCs expose only non-secret model UX metadata (`listChatIntegrations` returns connection id, name, default model, and the allowlist). The streamed response carries tokens, tool calls, and tool results (already redacted by their source procedures), never the credential. The no-secret-leak guarantee is regression-guarded across every AI DTO in `core/ai-backend/src/hardening/no-secret-leak.test.ts`.

The free-form `ai_messages.content` and `model_messages` bags are an exception that could, in principle, carry a credential if a buggy or malicious tool result smuggled one in. That guarantee is no longer merely architectural: `appendMessage` runs `scrubContent` on every message write, redacting any credential-shaped key (`apiKey`, `authorization`, `password`, `x-secret`, and similar) and any high-confidence credential value (an `sk-...` key, a `Bearer` token) before the row reaches Postgres. The scrub is conservative, so ordinary chat prose that merely mentions the word "token" or "password" is preserved; only credentials are stripped. The canary regression test injects a secret into message content and asserts it is stripped on write in `core/ai-backend/src/chat/scrub-content.test.ts` and `core/ai-backend/src/hardening/no-secret-leak.test.ts`.

## Related

Chat shares the [tool registry](/checkstack/developer-guide/ai/tool-registry/) and resolver with the [MCP server](/checkstack/developer-guide/ai/mcp-server/), and gates mutating tools through [propose and apply](/checkstack/developer-guide/ai/propose-apply/). A model that picks a tool the principal cannot use is refused server-side (guarded in `core/ai-backend/src/chat/agent-loop.test.ts` and `core/ai-backend/src/hardening/handler-authz.test.ts`), and cross-pod conversation readback is verified in `core/ai-backend/src/chat/conversation-store.it.test.ts`. See the [AI platform overview](/checkstack/developer-guide/ai/) for the full security model.
