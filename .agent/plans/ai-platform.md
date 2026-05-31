# AI platform — OpenAI-compatible integration, internal tool-calling chat, and an OAuth-secured MCP server

> **Status:** planned (design locked 2026-05-31, not started)
> **Branch:** TBD (off `main`, or off `feat/reactive-automation-engine` once that lands)
> **Original ask:** build AI into Checkstack as two surfaces over one shared spine — (1) user-configurable OpenAI-compatible credentials (a new Integration) powering an in-app chat where the model can call Checkstack tools (e.g. create automations from natural language), and (2) an MCP server Checkstack exposes so external tooling can call the same Checkstack tools. Both share an underlying architecture so capabilities aren't duplicated.

Self-contained handoff. A future session should pick up from here without prior chat context.

---

## 1. Locked decisions (from design Q&A)

1. **One tool registry, two transports.** The core abstraction is a transport-agnostic registry of callable *tools*. The internal chat agent loop and the external MCP server are both just transports over that one registry. No capability is implemented twice.
2. **Tool source — hybrid (opt-in projection + composite tools).** Tools come from two places: (a) **opt-in projection** of existing oRPC procedures — a procedure is explicitly marked AI-exposable and its zod schema + access-rule metadata (already emitted by the OpenAPI generator) is projected into a tool; (b) **purpose-built composite tools** (e.g. `automation.propose`) hand-authored where the LLM needs a coarser/curated surface than raw CRUD. NOT auto-deriving every procedure (would flood the model with hundreds of fine-grained endpoints and poor descriptions).
3. **Checkstack is its own OAuth 2.1 Authorization Server.** Implemented by enabling the better-auth `oidcProvider` + `mcp` first-party plugins (NOT currently enabled — only a custom `checkstackBridge` plugin is). Includes a consent screen and Dynamic Client Registration (with an admin toggle + rate-limit). MCP transport is **Streamable HTTP** (not the deprecated HTTP+SSE).
4. **Scopes narrow a principal (single source of truth).** OAuth scope strings ARE access-rule IDs (optionally with a small curated bundle layer like `checkstack:read` expanding to a set). A token is always bound to a real principal (a `user` or an `application` service account); at mint time the requested scopes are intersected with that principal's actual access rules **and team reach** — a token can only ever *narrow*, never widen, what the principal could already do in the UI. There is no parallel scope ACL that can drift. `autoAuthMiddleware` remains the single enforcement point for both transports.
5. **Authorization is enforced in the handler, never by the model.** The model only ever sees tools the resolved principal is already allowed to call, and each handler re-checks. The LLM is treated as an untrusted caller that happens to be good at picking arguments.
6. **Effect classification + human-in-the-loop.** Every tool declares `effect: "read" | "mutate" | "destructive"`. Read tools auto-run. Mutating/destructive tools use a transport-agnostic **two-step propose → apply** (propose returns a token; apply consumes it), reusing the mature `validateDefinition` / `renderConfig` dry-run pattern. In chat this renders a confirm card; over MCP it relies on the two-step token (since MCP elicitation isn't universally supported by clients). For automations specifically the flagship flow is **NL → `automation.propose` → validated draft YAML → existing collapsed-card editor → human applies** (the AI never silently creates an automation).
7. **LLM client — Vercel AI SDK.** Provider-agnostic via base-URL override (OpenAI / Azure / OpenRouter / Ollama / vLLM / LM Studio), with a built-in tool-calling loop, streaming, and zod tool schemas. The agent loop runs **server-side** (creds never leave the backend).
8. **Build order — MCP server first.** Stand up the registry + OAuth AS + MCP endpoint with read-only tools, validate against a real external client (Claude/Cursor), then build the internal chat loop on the same registry (the easy half — logged-in user as principal, no token plumbing).
9. **State is scale-correct (repo rule).** Conversation history and any agent state live in Postgres so any pod can continue a chat. The only pod-local thing is the live MCP/Streamable-HTTP connection registry (same exception as the existing WebSocket registry; mark it `declareNonReactiveState({ reason: "bookkeeping" })`).

---

## 2. Current-state facts (verified in repo)

### Reused wholesale (already exists)
- **zod → JSON Schema:** zod v4. `toJsonSchema()` at [core/backend-api/src/schema-utils.ts:100](../../core/backend-api/src/schema-utils.ts#L100) wraps native `z.toJSONSchema()` and stamps an extensible `x-*` metadata registry (`ConfigMeta` at [core/backend-api/src/zod-config.ts:12](../../core/backend-api/src/zod-config.ts#L12)). Directly reusable for BOTH OpenAI function schemas and MCP tool schemas — zero net-new serializer.
- **OpenAPI from contracts:** the oRPC contracts already generate a full OpenAPI spec carrying per-procedure access-rule metadata at [core/backend/src/openapi-router.ts:108](../../core/backend/src/openapi-router.ts#L108) (uses `@orpc/zod/zod4` `ZodToJsonSchemaConverter`). This is the substrate for the opt-in tool projection (decision 2).
- **Versioned schemas:** `Versioned<T>` at [core/backend-api/src/config-versioning.ts:123](../../core/backend-api/src/config-versioning.ts#L123) gives tool-schema evolution + migrations for free.
- **Token → principal path:** API-key auth `Bearer ck_<uuid>_<secret>` → bcrypt-verified `application` row → roles → `accessRules` → `teamIds`, producing an `ApplicationUser`, at [core/auth-backend/src/index.ts:344-438](../../core/auth-backend/src/index.ts#L344). An OAuth-JWT principal is a *variant of this existing path* — swap the credential parse, keep the enrichment.
- **Principal enrichment:** `enrichUser()` at [core/auth-backend/src/utils/user.ts:11-70](../../core/auth-backend/src/utils/user.ts#L11) yields `{ roles, accessRules, teamIds }` (admin → `"*"`). Principal types (`RealUser` / `ServiceUser` / `ApplicationUser`) in `core/backend-api/src/types.ts`.
- **Authorization middleware:** `autoAuthMiddleware` at [core/backend-api/src/rpc.ts:116-250](../../core/backend-api/src/rpc.ts#L116) — separates `globalOnlyRules` vs `instanceRules`, does S2S team checks. Single enforcement point to reuse.
- **Team scoping:** `userTeam` / `applicationTeam` / `resourceTeamAccess` / `resourceAccessSettings.teamOnly` (auth schema), enforced via S2S `checkResourceTeamAccess()` / `getAccessibleResourceIds()` at [core/auth-backend/src/router.ts:1743-1813](../../core/auth-backend/src/router.ts#L1743). Tokens already carry `teamIds`.
- **JWT signing + JWKS:** RS256 keystore (1h rotation, 24h grace) at [core/backend/src/services/keystore.ts](../../core/backend/src/services/keystore.ts); JWKS endpoint at [core/backend/src/index.ts:292](../../core/backend/src/index.ts#L292).
- **Propose/dry-run pattern:** `validateDefinition` RPC ([core/automation-common/src/rpc-contract.ts:115](../../core/automation-common/src/rpc-contract.ts#L115)) + `collectDefinitionIssues()` ([core/automation-backend/src/validate-definition.ts](../../core/automation-backend/src/validate-definition.ts)) validate without executing; the editor calls it live/debounced before save. `renderConfig` ([core/automation-backend/src/dispatch/render.ts](../../core/automation-backend/src/dispatch/render.ts)) dry-runs templates; `EntityHandle.mutate` snapshots before apply. This IS the propose→apply backbone.
- **Integration provider pattern:** `IntegrationProvider` at [core/integration-backend/src/provider-types.ts:75-118](../../core/integration-backend/src/provider-types.ts#L75) — `connectionSchema: Versioned<T>` with `x-secret` fields, `testConnection()`, `getConnectionOptions()`. Credentials stored via Secrets Vault (`__connref__` markers / `${{ secrets.NAME }}`). The OpenAI-compatible integration is a new provider of this exact shape.
- **Extension-point registration:** plugins contribute via buffered extension points resolved at init, e.g. `env.getExtensionPoint(automationActionExtensionPoint).registerAction(action, pluginMetadata)` (IDs auto-qualified by plugin id). The `aiTool` registry follows this verbatim.
- **HTTP mount:** Hono + oRPC; plugins register custom HTTP handlers via the `pluginHttpHandlers` registry, mounting under `/api/:pluginId/*` ([core/backend/src/plugin-manager/plugin-loader.ts:318-348](../../core/backend/src/plugin-manager/plugin-loader.ts#L318)). The MCP endpoint + OAuth provider routes mount here.
- **Schema-driven forms:** `DynamicForm` ([core/ui/src/components/DynamicForm/DynamicForm.tsx](../../core/ui/src/components/DynamicForm/DynamicForm.tsx)) renders JSON Schema + `x-*` annotations — reused for the integration config form.
- **Audit substrate:** `entity_transitions` ([core/automation-backend/src/schema.ts:417](../../core/automation-backend/src/schema.ts#L417)) and `plugin_install_events` + `PluginEventRecorder` ([core/backend/src/services/plugin-event-recorder.ts](../../core/backend/src/services/plugin-event-recorder.ts)) are the model for an `ai_tool_calls` table. `emitHook` event bus exists for cross-plugin events.

### Net-new (must build)
- better-auth `oidcProvider` + `mcp` plugins are **not enabled** (only `checkstackBridge`); no JWT-claims customization hook (`definePayload`) exists yet.
- No OAuth scope → (access-rules + teams) narrowing logic.
- No LLM client of any kind present (the Anomaly system is pure statistical sigma/drift — `core/anomaly-backend/src/detector.ts` — no models, no API calls; consume its events as context, don't touch its logic).
- No `aiTool` registry / effect-classification / two-step propose-apply token infra (no idempotency-key infra anywhere today).
- No `ai_tool_calls` audit table.
- **No rate-limiting middleware anywhere** — genuinely absent; required for the open DCR endpoint + per-principal token/spend budgets.

---

## 3. Architecture

### Packages
- `core/ai-common` — zod schemas (tool descriptor, `effect`, OpenAI-compatible integration `connectionSchema` as `Versioned<T>`, chat message/conversation shapes, MCP tool/resource/prompt projection types, propose/apply token), oRPC contract, access rules (`ai.chat.use`, `ai.tools.manage`, `ai.mcp.manage`, …), plugin metadata, hook ids (`ai.toolCalled`).
- `core/ai-backend` — the **tool registry** (`aiToolExtensionPoint` + `aiToolProjectionExtensionPoint` for opt-in oRPC projection), the **registry resolver** (filters tools by principal access rules + team reach), the zod→JSON-Schema tool serializer (wraps `toJsonSchema()`), the **server-side agent loop** (Vercel AI SDK), the **MCP server** (Streamable HTTP) + `withMcpAuth`, the OpenAI-compatible **Integration provider**, conversation persistence, the `ai_tool_calls` audit writer, and the two-step propose/apply token store. Mounts MCP + (delegated) OAuth routes via `pluginHttpHandlers`.
- `core/ai-frontend` — Settings → AI (configure OpenAI-compatible integration via `DynamicForm`; manage MCP clients / DCR toggle), and (Phase 4) the chat UI.
- **better-auth wiring** lives in `core/auth-backend` (enable `oidcProvider` + `mcp` plugins, add the claims hook). `ai-backend` consumes the AS as a Resource Server.

### Tool registry (the spine)
```ts
interface AiTool<TInput> {
  name: string;                       // auto-qualified by plugin id, e.g. "automation.propose"
  description: string;                // model-facing
  input: z.ZodType<TInput>;           // -> JSON Schema via toJsonSchema(), for both OpenAI & MCP
  effect: "read" | "mutate" | "destructive";
  requiredAccessRules: string[];      // SAME vocabulary as OAuth scopes AND autoAuthMiddleware
  execute(args: { input: TInput; principal: AuthUser }): Promise<unknown>;
}
```
Two registration paths (decision 2):
- `aiToolExtensionPoint.registerTool(tool, pluginMetadata)` — hand-authored composite tools.
- `aiToolProjectionExtensionPoint.expose({ procedure, description, effect })` — opt-in projection of an existing oRPC procedure; schema + access rules come from its contract/OpenAPI metadata.

### Resolver + transports
- **Resolver:** given a principal, returns the subset of tools whose `requiredAccessRules` are satisfied (and team reach respected). Used identically by both transports.
- **Internal chat (Phase 4):** Vercel AI SDK agent loop, principal = logged-in `RealUser`, tools = resolver output, streams tokens + tool events to the frontend. Context-aware (seed with the user's current location — this incident, this automation editor).
- **MCP server (Phase 2/3):** Streamable HTTP endpoint adapting the same resolver output into MCP tool defs. Auth via better-auth `mcp` plugin (`withMcpAuth`) → OAuth token → principal (variant of the `application` path). Also exposes MCP **resources** (incidents / health-checks / anomalies as read-context) and **prompts** (canned "draft an automation for X").

### OAuth AS + scope narrowing
- Enable `oidcProvider` (issues tokens, consent UI, PKCE, DCR) + `mcp` (publishes MCP discovery metadata) in `auth-backend`.
- Add a JWT-claims hook (`definePayload`-style) that, at mint time, intersects requested scopes with the principal's `accessRules` + `teamIds` and embeds the narrowed set as claims.
- Bearer-JWT branch in/around `autoAuthMiddleware`: validate the JWT (existing JWKS), resolve to a principal with the **narrowed** access rules + teams, then enforce exactly as today. One enforcement path.

### Effect / confirmation
- Read tools: auto-run.
- Mutate/destructive: `propose` runs the dry-run (reusing `validateDefinition` / `renderConfig`), persists a short-lived proposal + returns a token; `apply` re-validates and commits. Chat renders a confirm card; MCP returns the proposal for a follow-up `apply` call.

### Audit + rate-limit
- `ai_tool_calls` table records every invocation (principal, tool, args hash, effect, status `proposed|applied|executed|failed`, result snapshot, timestamps). Emit `ai.toolCalled` hook for subscribers.
- New Hono rate-limit middleware: per-principal tool budgets + DCR endpoint throttle + optional per-org LLM spend cap.

---

## 4. Data model (Drizzle, `ai-backend`)
- `ai_conversations(id pk, user_id, title, integration_id, created_at, updated_at)` — durable so any pod can continue a chat.
- `ai_messages(id pk, conversation_id fk, role, content jsonb, tool_calls jsonb, created_at)`.
- `ai_tool_calls(id pk, principal_kind, principal_id, transport /* chat|mcp */, tool_name, args_hash, effect, status, result_snapshot jsonb, proposed_at, applied_at)` — audit + the propose/apply two-step token store (proposal token = row id + nonce, short TTL).
- OAuth client / consent / token tables are owned by the better-auth `oidcProvider` plugin (its own migrations) — do NOT hand-roll them.
- OpenAI-compatible integration credentials live in the Secrets Vault via the existing integration `connectionSchema` `x-secret` mechanism — no new secret table.

## 5. RPC contract (`ai-common`)
- `ai.chat.use`-gated: `listConversations`, `getConversation`, `sendMessage` (drives the server-side agent loop; streams), `proposeToolApply` / `confirmToolApply` (two-step).
- `ai.tools.manage`-gated: `listTools` (introspection), manage projections.
- `ai.mcp.manage`-gated: list/revoke MCP clients, toggle DCR.
- Integration config reuses the standard integration-provider RPCs (test connection, set credentials) — nothing AI-specific.
- **No endpoint returns the integration's API key to the browser** (Secrets Vault masking applies, as with every integration).

## 6. Phasing
1. **Phase 1 — spine + integration.** `ai-common` + `ai-backend` skeleton; `aiToolExtensionPoint` + `aiToolProjectionExtensionPoint`; resolver (principal → allowed tools); zod→JSON-Schema tool serializer (wrap `toJsonSchema()`); the OpenAI-compatible Integration provider + Settings UI. A handful of read-only tools registered (`incident.list/summarize`, `healthcheck.status`, `anomaly.explain`) — projected from existing procedures where possible.
2. **Phase 2 — OAuth AS + MCP server (read-only).** Enable better-auth `oidcProvider` + `mcp`; claims hook + scope→(rules+teams) narrowing; bearer-JWT principal resolution into `autoAuthMiddleware`; Streamable-HTTP MCP endpoint exposing the read-only tools + MCP resources/prompts; consent screen; DCR toggle + rate-limit. **Validate end-to-end against a real external client (Claude/Cursor).**
3. **Phase 3 — mutating tools + propose/apply + audit.** Effect classification; two-step propose→apply (reusing `validateDefinition`/`renderConfig`); the flagship `automation.propose` feeding the existing collapsed-card editor; `ai_tool_calls` audit table + `ai.toolCalled` hook; per-principal rate-limit budgets.
4. **Phase 4 — internal chat.** Server-side Vercel AI SDK agent loop on the same registry (principal = logged-in user); conversation persistence; streaming chat UI; context-aware seeding; confirm cards for mutate/destructive.
5. **Phase 5 — docs + changesets + hardening.** Security tests (scope narrowing can never widen; handler-side authz holds when the model misbehaves; no secret crosses a DTO), MCP conformance, rate-limit/DCR abuse tests.

## 7. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Model calls a tool the principal can't use | Resolver only surfaces allowed tools AND each handler re-checks via `autoAuthMiddleware`; model is untrusted. |
| OAuth scope widens privileges | Scopes = access-rule IDs intersected with the real principal's rules + teams at mint; narrow-only; single enforcement path. No parallel ACL. |
| Cross-pod chat continuity | Conversations/messages in Postgres; only the live connection registry is pod-local (`declareNonReactiveState`). |
| Destructive tool runs without consent | Effect classification + two-step propose→apply token; chat confirm card; MCP follow-up `apply`. |
| AI silently mutates automations | `automation.propose` produces a validated draft into the existing editor; human applies. |
| Integration API key leaks | Stored in Secrets Vault (`x-secret`); never returned to browser; existing masking. |
| Open DCR endpoint abuse | Admin toggle + rate-limit; clients listable/revocable. |
| LLM cost runaway | Per-org spend cap + per-principal tool budgets; model selection per integration. |
| Projecting too many procedures floods the model | Opt-in projection only (decision 2); curated composite tools where coarser surface is needed. |
| better-auth provider plugin ↔ custom RBAC mismatch | Claims hook is the single seam; RBAC truth stays in custom tables; confirm hook ergonomics in Phase 2 spike. |

## 8. Cross-cutting (repo rules)
- TDD (`bun test`), no `any`, no `eslint-disable`, zod 4. Run `bun run typecheck:references:generate` after adding the new packages / deps and commit the tsconfig changes. `bun run lint` + `bun run typecheck` from root before done. Changesets (minor, beta; `BREAKING CHANGES:` where contracts move). Docs under `docs/src/content/docs/` in the same phase (new AI section + the events/contracts the MCP server exposes). Storybook story for any new `@checkstack/ui` component. No em-dashes in user-facing content.
- **State-and-scale answer (required in changeset/PR):** conversation + tool-call state lives in Postgres (same answer on every pod); the live MCP connection registry is the only pod-local piece and is non-authoritative bookkeeping.

## 9. Open items to confirm during implementation
- Exact better-auth `oidcProvider`/`mcp` plugin version compatibility at 1.4.7 and the precise claims-injection hook API (the one real Phase-2 spike).
- Scope grammar: raw access-rule IDs vs a small curated bundle layer (`checkstack:read` → set) — lean raw IDs + optional bundles.
- Whether MCP resources are derived from entity reads or hand-authored.
- Proposal-token TTL + storage (row in `ai_tool_calls` vs separate ephemeral table).
- Rate-limit store (Postgres counter vs in-memory per-pod — must be shared to be correct under scale).
- Default model + per-integration model selection UX.
