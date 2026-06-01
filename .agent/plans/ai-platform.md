# AI platform — OpenAI-compatible integration, internal tool-calling chat, and an OAuth-secured MCP server

> **Status:** planned (design locked 2026-05-31; hardened into an
> assumption-free handoff 2026-06-01, not started)
> **Branch:** TBD (off `main`, or off `feat/reactive-automation-engine` once that lands)
> **Original ask:** build AI into Checkstack as two surfaces over one shared spine — (1) user-configurable OpenAI-compatible credentials (a new Integration) powering an in-app chat where the model can call Checkstack tools (e.g. create automations from natural language), and (2) an MCP server Checkstack exposes so external tooling can call the same Checkstack tools. Both share an underlying architecture so capabilities aren't duplicated.

Self-contained handoff. Pick up from this document alone. Every current-state
claim carries a `file:line` anchor so the implementer never has to guess. The
exemplars this plan matches for depth and rigor are
[`.agent/plans/reactive-automation-engine.md`](./reactive-automation-engine.md)
and [`.agent/plans/automation-platform.md`](./automation-platform.md).

---

## 1. Locked decisions (from design Q&A)

> These are **not** re-litigated below. Sections 2-13 deepen the spec; if an open
> item (§9, now resolved into §11-§14) forced a decision change it is flagged
> inline as `DECISION-CHANGE` for review, never silently flipped. No locked
> decision changed during this build-out.

1. **One tool registry, two transports.** The core abstraction is a transport-agnostic registry of callable *tools*. The internal chat agent loop and the external MCP server are both just transports over that one registry. No capability is implemented twice.
2. **Tool source — hybrid (opt-in projection + composite tools).** Tools come from two places: (a) **opt-in projection** of existing oRPC procedures — a procedure is explicitly marked AI-exposable and its zod schema + access-rule metadata (already emitted by the OpenAPI generator) is projected into a tool; (b) **purpose-built composite tools** (e.g. `automation.propose`) hand-authored where the LLM needs a coarser/curated surface than raw CRUD. NOT auto-deriving every procedure (would flood the model with hundreds of fine-grained endpoints and poor descriptions).
3. **Checkstack is its own OAuth 2.1 Authorization Server.** Implemented by enabling the better-auth `oidcProvider` + `mcp` first-party plugins (NOT currently enabled — only a custom `checkstackBridge` plugin is, [core/auth-backend/src/index.ts:568](../../core/auth-backend/src/index.ts#L568), [:719](../../core/auth-backend/src/index.ts#L719)). Includes a consent screen and Dynamic Client Registration (with an admin toggle + rate-limit). MCP transport is **Streamable HTTP** (not the deprecated HTTP+SSE).
4. **Scopes narrow a principal (single source of truth).** OAuth scope strings ARE access-rule IDs (optionally with a small curated bundle layer like `checkstack:read` expanding to a set). A token is always bound to a real principal (a `user` or an `application` service account); at mint time the requested scopes are intersected with that principal's actual access rules **and team reach** — a token can only ever *narrow*, never widen, what the principal could already do in the UI. There is no parallel scope ACL that can drift. `autoAuthMiddleware` ([core/backend-api/src/rpc.ts:116](../../core/backend-api/src/rpc.ts#L116)) remains the single enforcement point for both transports.
5. **Authorization is enforced in the handler, never by the model.** The model only ever sees tools the resolved principal is already allowed to call, and each handler re-checks. The LLM is treated as an untrusted caller that happens to be good at picking arguments.
6. **Effect classification + human-in-the-loop.** Every tool declares `effect: "read" | "mutate" | "destructive"`. Read tools auto-run. Mutating/destructive tools use a transport-agnostic **two-step propose → apply** (propose returns a token; apply consumes it), reusing the mature `validateDefinition` / `renderConfig` dry-run pattern. In chat this renders a confirm card; over MCP it relies on the two-step token (since MCP elicitation isn't universally supported by clients). For automations specifically the flagship flow is **NL → `automation.propose` → validated draft YAML → existing collapsed-card editor → human applies** (the AI never silently creates an automation).
7. **LLM client — Vercel AI SDK.** Provider-agnostic via base-URL override (OpenAI / Azure / OpenRouter / Ollama / vLLM / LM Studio), with a built-in tool-calling loop, streaming, and zod tool schemas. The agent loop runs **server-side** (creds never leave the backend).
8. **Build order — MCP server first.** Stand up the registry + OAuth AS + MCP endpoint with read-only tools, validate against a real external client (Claude/Cursor), then build the internal chat loop on the same registry (the easy half — logged-in user as principal, no token plumbing).
9. **State is scale-correct (repo rule).** Conversation history and any agent state live in Postgres so any pod can continue a chat. The only pod-local thing is the live MCP/Streamable-HTTP connection registry (same exception as the existing WebSocket registry; mark it `declareNonReactiveState({ reason: "bookkeeping" })`).

---

## 2. Current-state facts (verified in repo, 2026-06-01)

> Every anchor below was re-verified against the `docs/buildout-plans` worktree
> (HEAD `e806301a`). Anchors that the issue's "Technical notes" flagged still
> resolve.

### Reused wholesale (already exists)
- **zod → JSON Schema:** zod v4. `toJsonSchema()` at [core/backend-api/src/schema-utils.ts:100](../../core/backend-api/src/schema-utils.ts#L100) wraps native `zodSchema.toJSONSchema()` and stamps an extensible `x-*` metadata registry (`ConfigMeta` at [core/backend-api/src/zod-config.ts:12](../../core/backend-api/src/zod-config.ts#L12), `x-secret` at `:13`). Directly reusable for BOTH OpenAI function schemas and MCP tool schemas — zero net-new serializer.
- **OpenAPI from contracts:** the oRPC contracts already generate a full OpenAPI spec carrying per-procedure access-rule metadata via `x-orpc-meta`, built with the `@orpc/zod/zod4` `ZodToJsonSchemaConverter` at [core/backend/src/openapi-router.ts:108](../../core/backend/src/openapi-router.ts#L108) (`buildMetadataLookup` at `:106`, `x-orpc-meta` post-process at `:128`). This is the substrate for the opt-in tool projection (decision 2).
- **Versioned schemas:** `Versioned<T>` at [core/backend-api/src/config-versioning.ts:123](../../core/backend-api/src/config-versioning.ts#L123) gives tool-schema + integration-connection evolution + migrations for free.
- **Token → principal path:** API-key auth `Bearer ck_<uuid>_<secret>` → bcrypt-verified `application` row → roles → `accessRules` → `teamIds`, producing an `ApplicationUser`, in the `authenticationStrategyServiceRef.validate(request)` callback at [core/auth-backend/src/index.ts:337-452](../../core/auth-backend/src/index.ts#L337) (the `ck_` branch is `:345-439`, returns an `ApplicationUser` at `:426-433`; session fallback at `:441-450`). **The OAuth-JWT principal is a third branch of THIS exact callback** — see §6.
- **Principal enrichment:** `enrichUser()` at [core/auth-backend/src/utils/user.ts:11-70](../../core/auth-backend/src/utils/user.ts#L11) yields a `RealUser` with `{ roles, accessRules, teamIds }` (admin role → `accessRules: ["*"]`, `:30-32`). Principal types `RealUser` ([core/backend-api/src/types.ts:61](../../core/backend-api/src/types.ts#L61)), `ServiceUser` (`:76`), `ApplicationUser` (`:85`), union `AuthUser` (`:98`); the strategy contract `AuthenticationStrategy.validate` returns `RealUser | ApplicationUser | undefined` (`:138-140`).
- **Authorization middleware:** `autoAuthMiddleware` at [core/backend-api/src/rpc.ts:116-...](../../core/backend-api/src/rpc.ts#L116) — reads `meta.userType` (`:119`) + `meta.access` (`:120`), qualifies rules (`:126-135`), separates `globalOnlyRules` vs `instanceRules` (`:138-151`), checks global rules against `user.accessRules` with the `"*"` admin escape (`:259`), and S2S team checks for instance rules. **Single enforcement point** — the JWT principal flows through it unchanged because it is just another `accessRules`/`teamIds`-bearing principal.
- **Team scoping:** `userTeam` / `applicationTeam` / `resourceTeamAccess` / `resourceAccessSettings.teamOnly` (auth schema), enforced via the S2S `checkResourceTeamAccess` handler at [core/auth-backend/src/router.ts:1743](../../core/auth-backend/src/router.ts#L1743) (reads `resourceTeamAccess` grants `:1753+`). Tokens already carry `teamIds`.
- **JWT signing + JWKS:** RS256 keystore at [core/backend/src/services/keystore.ts](../../core/backend/src/services/keystore.ts); JWKS endpoint `/.well-known/jwks.json` at [core/backend/src/index.ts:292](../../core/backend/src/index.ts#L292) (`keyStore.getPublicJWKS()` at `:294`; key bootstrap at `:385-387`). The OAuth AS can reuse this keystore for token signing OR the better-auth plugin can own its own JWKS — resolved in §11.
- **Propose/dry-run pattern:** `validateDefinition` RPC at [core/automation-common/src/rpc-contract.ts:115](../../core/automation-common/src/rpc-contract.ts#L115) (`access: [automationAccess.read]`, `:118`) + `collectDefinitionIssues()` at [core/automation-backend/src/validate-definition.ts:46](../../core/automation-backend/src/validate-definition.ts#L46) validate without executing; the editor calls it live/debounced before save. `renderConfig` at [core/automation-backend/src/dispatch/render.ts:78](../../core/automation-backend/src/dispatch/render.ts#L78) dry-runs templates. This IS the propose→apply backbone.
- **Integration provider pattern:** `IntegrationProvider<TConnection>` at [core/integration-backend/src/provider-types.ts:75](../../core/integration-backend/src/provider-types.ts#L75) — `connectionSchema?: Versioned<TConnection>` (`:94`) with `x-secret` fields, `testConnection?()` (`:108`), `getConnectionOptions?()` (`:115`). The provider DTO's `connectionSchema` is emitted as JSON Schema for the UI at [core/integration-common/src/schemas.ts:150](../../core/integration-common/src/schemas.ts#L150). Credentials stored via Secrets Vault (`__connref__` markers / `${{ secrets.NAME }}`). The OpenAI-compatible integration is a new provider of this exact shape.
- **Extension-point registration:** plugins contribute via buffered extension points resolved at init, e.g. `automationActionExtensionPoint` at [core/automation-backend/src/extension-points.ts:45](../../core/automation-backend/src/extension-points.ts#L45) with `registerAction(definition, pluginMetadata)` (`:38-41`); `createExtensionPoint<T>(id)` is the factory. IDs are auto-qualified by plugin id. The `aiTool` registry follows this verbatim (§5).
- **HTTP mount:** Hono + oRPC; plugins register custom HTTP handlers via the `pluginHttpHandlers` registry — declared at [core/backend/src/plugin-manager.ts:35](../../core/backend/src/plugin-manager.ts#L35), threaded through [core/backend/src/plugin-manager/core-services.ts:59](../../core/backend/src/plugin-manager/core-services.ts#L59) (`Map<string, (req: Request) => Promise<Response>>`, `:65`; `.set(fullPath, handler)` at `:346`), consumed by the API route handler at [core/backend/src/plugin-manager/plugin-loader.ts:336](../../core/backend/src/plugin-manager/plugin-loader.ts#L336). The MCP endpoint + OAuth provider routes mount here.
- **Schema-driven forms:** `DynamicForm` ([core/ui/src/components/DynamicForm/DynamicForm.tsx](../../core/ui/src/components/DynamicForm/DynamicForm.tsx)) renders JSON Schema + `x-*` annotations — reused for the integration config form (§7).
- **Automation editor seam:** the collapsed-card definition editor lives in [core/automation-frontend/src/editor/](../../core/automation-frontend/src/editor/) (`AutomationDefinitionContext.tsx`, `ActionListEditor.tsx`). The flagship `automation.propose` flow seeds a draft definition into this editor (§3, §8).
- **Audit substrate:** `plugin_install_events` table + `PluginEventRecorder` at [core/backend/src/schema.ts:92-124](../../core/backend/src/schema.ts#L92) (`id uuid pk`, `action`/`phase`/`status` text, `source jsonb`, `instanceId`/`userId` text, `createdAt` timestamp, two composite indexes) is the column-shape model for `ai_tool_calls`. `entity_transitions` (automation-backend) is the audit-log precedent. `emitHook` event bus exists for cross-plugin events.
- **Access-rule factory:** `access(resource, action, description)` from `@checkstack/common`, used e.g. `automationAccess` at [core/automation-common/src/access.ts:6](../../core/automation-common/src/access.ts#L6) (`read` at `:11`, `manage` at `:19`, array export at `:29`). The `ai.*` rules (§5) follow this shape exactly.

### Net-new (must build — greenfield)
- No `core/ai-common`, `core/ai-backend`, or `core/ai-frontend` packages exist (a `core/ai-*` glob matches nothing). **When these land, run `bun run typecheck:references:generate` and commit the generated tsconfig changes** ([.agent/rules/typecheck.md](../rules/typecheck.md)).
- No Vercel AI SDK / `@ai-sdk` dependency anywhere in the workspace (grep of every `package.json` for `@ai-sdk` / `"ai":` returns nothing).
- better-auth `oidcProvider` + `mcp` plugins are **not enabled** (only `checkstackBridge`, [core/auth-backend/src/index.ts:719](../../core/auth-backend/src/index.ts#L719)); no JWT-claims customization hook exists yet. `better-auth` is `^1.4.7` in both [core/auth-backend/package.json](../../core/auth-backend/package.json) and [core/backend/package.json](../../core/backend/package.json).
- No OAuth scope → (access-rules + teams) narrowing logic.
- No LLM client of any kind present (the Anomaly system at [core/anomaly-backend/src/detector.ts](../../core/anomaly-backend/src/detector.ts) is pure statistical sigma/drift — no models, no API calls; consume its events as context, don't touch its logic).
- No `aiTool` registry / effect-classification / two-step propose-apply token infra (no idempotency-key infra anywhere today).
- No `ai_conversations` / `ai_messages` / `ai_tool_calls` tables.
- **No rate-limiting middleware anywhere** — genuinely absent (grep of `core/backend{,-api}/src` for `rate.?limit` returns nothing); required for the open DCR endpoint + per-principal token/spend budgets.
- No AI/MCP docs section exists; the docs site has exactly two top-level sections under [docs/src/content/docs/](../../docs/src/content/docs/): `developer-guide/` and `user-guide/`. Architecture pages live under [docs/src/content/docs/developer-guide/architecture/](../../docs/src/content/docs/developer-guide/architecture/). The new AI docs go under `developer-guide/` (§15).

---

## 3. Architecture

### Packages
- `core/ai-common` — zod schemas (tool descriptor, `effect`, OpenAI-compatible integration `connectionSchema` as `Versioned<T>`, chat message/conversation shapes, MCP tool/resource/prompt projection types, propose/apply token), oRPC contract, access rules (`ai.chat.use`, `ai.tools.manage`, `ai.mcp.manage`), plugin metadata, hook ids (`ai.toolCalled`). Depends on `@checkstack/common`.
- `core/ai-backend` — the **tool registry** (`aiToolExtensionPoint` + `aiToolProjectionExtensionPoint`), the **resolver** (principal → allowed tools, team-reach filtered), the zod→JSON-Schema tool serializer (wraps `toJsonSchema()`), the **server-side agent loop** (Vercel AI SDK), the **MCP server** (Streamable HTTP) + the `withMcpAuth` adapter, the OpenAI-compatible **Integration provider**, conversation persistence, the `ai_tool_calls` audit writer, and the two-step propose/apply token store. Mounts MCP + (delegated) OAuth routes via `pluginHttpHandlers`. Depends on `@checkstack/ai-common`, `@checkstack/backend-api`, `@checkstack/integration-backend`, `@checkstack/automation-backend`.
- `core/ai-frontend` — Settings → AI (configure OpenAI-compatible integration via `DynamicForm`; manage MCP clients / DCR toggle), and (Phase 4) the chat UI. Depends on `@checkstack/ai-common`, `@checkstack/ui`.
- **better-auth wiring** lives in `core/auth-backend` (enable `oidcProvider` + `mcp` plugins, add the claims/narrowing hook). `ai-backend` consumes the AS as a Resource Server. No new package for the AS.

> **References reminder:** all four `@checkstack/*` dep edges above (and the
> better-auth dev/runtime deps) require `bun run typecheck:references:generate`
> + committed tsconfig changes once the packages exist
> ([.agent/rules/typecheck.md](../rules/typecheck.md)).

### Tool registry (the spine)
```ts
// core/ai-common/src/tool.ts (NEW)
import { z } from "zod";
import type { AuthUser } from "@checkstack/backend-api";

export const AiToolEffectSchema = z.enum(["read", "mutate", "destructive"]);
export type AiToolEffect = z.infer<typeof AiToolEffectSchema>;

export interface AiTool<TInput = unknown, TOutput = unknown> {
  /** Auto-qualified by plugin id on registration, e.g. "automation.propose". */
  name: string;
  /** Model-facing description (becomes the OpenAI/MCP tool description). */
  description: string;
  /** zod input; -> JSON Schema via toJsonSchema() for both OpenAI & MCP. */
  input: z.ZodType<TInput>;
  /** Optional zod output; documents the tool result shape to the model. */
  output?: z.ZodType<TOutput>;
  effect: AiToolEffect;
  /** SAME vocabulary as OAuth scopes AND autoAuthMiddleware access-rule ids. */
  requiredAccessRules: string[];
  /**
   * For mutate/destructive read tools: optional dry-run used by `propose`.
   * Returns a human-readable summary + the validated payload to be applied.
   */
  dryRun?(args: { input: TInput; principal: AuthUser }): Promise<AiProposalPreview>;
  /** The actual call. For mutate/destructive this is only reached via `apply`. */
  execute(args: { input: TInput; principal: AuthUser }): Promise<TOutput>;
}
```

### Resolver + transports
- **Resolver:** given a principal, returns the subset of tools whose `requiredAccessRules` are satisfied by the principal's `accessRules` (with the `"*"` admin escape, mirroring `autoAuthMiddleware`) AND whose team reach the principal can satisfy. Used identically by both transports. Exact signature in §5.
- **Internal chat (Phase 4):** Vercel AI SDK agent loop, principal = logged-in `RealUser`, tools = resolver output, streams tokens + tool events to the frontend. Context-aware (seed with the user's current location — this incident, this automation editor).
- **MCP server (Phase 2/3):** Streamable HTTP endpoint adapting the same resolver output into MCP tool defs. Auth via better-auth `mcp` plugin (`withMcpAuth`) → OAuth token → principal (the JWT branch of the auth strategy, §6). Also exposes MCP **resources** (incidents / health-checks / anomalies as read-context) and **prompts** (canned "draft an automation for X").

### OAuth AS + scope narrowing
- Enable `oidcProvider` (issues tokens, consent UI, PKCE, DCR) + `mcp` (publishes MCP discovery metadata) in `auth-backend`.
- Add a JWT-claims hook that, at mint time, intersects requested scopes with the principal's `accessRules` + `teamIds` and embeds the narrowed set as claims (§6, §13).
- Bearer-JWT branch in the auth strategy (§6): validate the JWT, resolve to a principal with the **narrowed** access rules + teams, then enforce exactly as today via `autoAuthMiddleware`. One enforcement path.

### Effect / confirmation
- Read tools: auto-run.
- Mutate/destructive: `propose` runs `dryRun` (reusing `validateDefinition` / `renderConfig`), persists a short-lived proposal + returns a token; `apply` re-validates and commits. Chat renders a confirm card; MCP returns the proposal for a follow-up `apply` call.

### Audit + rate-limit
- `ai_tool_calls` table records every invocation. Emit `ai.toolCalled` hook for subscribers (§4, §10).
- New Hono rate-limit middleware backed by a **shared Postgres counter** (§14.5): per-principal tool budgets + DCR endpoint throttle + optional per-org LLM spend cap.

---

## 4. Data model (Drizzle, `core/ai-backend/src/schema.ts`)

> Column types follow the repo's established patterns: `text` PK with a
> `$defaultFn(() => crypto.randomUUID())` (matches `entity_transitions`) OR
> `uuid().defaultRandom()` (matches `plugin_install_events`,
> [core/backend/src/schema.ts:95](../../core/backend/src/schema.ts#L95)). We use
> `text` + `crypto.randomUUID()` for parity with the automation-backend tables
> the propose/apply flow integrates with. `jsonb().$type<…>()` is the established
> repo pattern. All timestamps are `timestamp(...).defaultNow().notNull()`.

```ts
// core/ai-backend/src/schema.ts (NEW)
import {
  pgTable,
  pgEnum,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const aiMessageRoleEnum = pgEnum("ai_message_role", [
  "system",
  "user",
  "assistant",
  "tool",
]);

export const aiTransportEnum = pgEnum("ai_transport", ["chat", "mcp"]);

export const aiToolEffectEnum = pgEnum("ai_tool_effect", [
  "read",
  "mutate",
  "destructive",
]);

export const aiToolCallStatusEnum = pgEnum("ai_tool_call_status", [
  "proposed", // dry-run done, token issued, awaiting apply
  "applied", // apply consumed the proposal token and committed
  "executed", // read tool ran directly (no proposal step)
  "failed", // execute/apply threw
  "expired", // proposal token TTL elapsed before apply
  "rejected", // human declined the confirm card / apply never called
]);

/** A durable chat conversation, continuable from any pod (decision 9). */
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** Owning real user (chat is RealUser-only). No FK: users live in the
     *  auth plugin's own Postgres schema (cross-plugin tables are not FK-linked
     *  in this codebase). Enforced at the handler via the session principal. */
    userId: text("user_id").notNull(),
    title: text("title"),
    /** Qualified integration connection id used for this conversation. */
    integrationId: text("integration_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("ai_conversations_user_idx").on(t.userId, t.updatedAt),
  }),
);

/** Append-only message log for a conversation. */
export const aiMessages = pgTable(
  "ai_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: aiMessageRoleEnum("role").notNull(),
    /** AI-SDK message parts: text + tool-call/tool-result parts. Secrets are
     *  masked before persist (§12). */
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    /** Tool calls emitted by an assistant turn (denormalized for fast render). */
    toolCalls: jsonb("tool_calls").$type<Array<Record<string, unknown>>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    convIdx: index("ai_messages_conversation_idx").on(
      t.conversationId,
      t.createdAt,
    ),
  }),
);

/**
 * Audit log for EVERY tool invocation across BOTH transports, AND the
 * propose/apply two-step token store. A `proposed` row IS the proposal token
 * (token = `${id}.${nonce}` — §13.4); `apply` looks the row up by id, checks
 * the nonce + TTL + status, then transitions it to `applied`.
 */
export const aiToolCalls = pgTable(
  "ai_tool_calls",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** "user" | "application" — never "service" (services bypass the registry). */
    principalKind: text("principal_kind").notNull(),
    principalId: text("principal_id").notNull(),
    transport: aiTransportEnum("transport").notNull(),
    /** Optional link back to a chat turn (null for MCP). */
    conversationId: text("conversation_id").references(
      () => aiConversations.id,
      { onDelete: "set null" },
    ),
    toolName: text("tool_name").notNull(),
    effect: aiToolEffectEnum("effect").notNull(),
    /** SHA-256 of the canonical-JSON args (never the raw args — may hold PII). */
    argsHash: text("args_hash").notNull(),
    status: aiToolCallStatusEnum("status").notNull(),
    /** propose/apply token nonce (random 32 bytes hex). Null for read tools. */
    proposalNonce: text("proposal_nonce"),
    /** Hard expiry of a `proposed` row (now + TTL, §13.4). */
    proposalExpiresAt: timestamp("proposal_expires_at"),
    /** dryRun preview / execute result snapshot (masked). */
    resultSnapshot: jsonb("result_snapshot").$type<Record<string, unknown>>(),
    /** The validated, ready-to-apply payload captured at propose time. */
    proposedPayload: jsonb("proposed_payload").$type<Record<string, unknown>>(),
    error: text("error"),
    proposedAt: timestamp("proposed_at"),
    appliedAt: timestamp("applied_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // Per-principal budget counter window scan (§14.5) + audit listing.
    principalCreatedIdx: index("ai_tool_calls_principal_created_idx").on(
      t.principalKind,
      t.principalId,
      t.createdAt,
    ),
    // Proposal-token lookup at apply time + the TTL prune sweep.
    statusExpiresIdx: index("ai_tool_calls_status_expires_idx").on(
      t.status,
      t.proposalExpiresAt,
    ),
    convIdx: index("ai_tool_calls_conversation_idx").on(t.conversationId),
  }),
);
```

**Propose/apply token shape (decided — §13.4):**
- A proposal is a row in `ai_tool_calls` with `status = "proposed"`, a random
  `proposalNonce`, and `proposalExpiresAt = now + TTL`.
- The opaque token handed to the caller / chat client is
  `propose:<rowId>.<nonce>` (base64url). `apply` parses it, fetches the row by
  id, and rejects unless `status = "proposed"`, the nonce matches in constant
  time, and `proposalExpiresAt > now`.
- **No separate ephemeral table** — the audit row IS the token store (decided
  §13.4). A background sweep (§14.5) flips expired `proposed` rows to `expired`,
  preserving them as audit history.

**Not hand-rolled:** OAuth client / consent / access-token / refresh-token
tables are owned by the better-auth `oidcProvider` plugin (its own migrations).
Do NOT define them here. OpenAI-compatible integration credentials live in the
Secrets Vault via the existing integration `connectionSchema` `x-secret`
mechanism — no new secret table.

---

## 5. Tool registry + RPC contract (`core/ai-common`)

### 5.1 Extension points + exact signatures

```ts
// core/ai-backend/src/extension-points.ts (NEW) — mirrors automation-backend
import { createExtensionPoint } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import type { AiTool, AiToolEffect } from "@checkstack/ai-common";
import type { ContractProcedure } from "@orpc/contract"; // the projected proc's type

/** Path 1 — hand-authored composite tools (decision 2b). */
export interface AiToolExtensionPoint {
  registerTool<TInput, TOutput>(
    tool: AiTool<TInput, TOutput>,
    pluginMetadata: PluginMetadata,
  ): void;
}
export const aiToolExtensionPoint =
  createExtensionPoint<AiToolExtensionPoint>("ai.toolExtensionPoint");

/** Path 2 — opt-in projection of an existing oRPC procedure (decision 2a). */
export interface AiToolProjectionExtensionPoint {
  expose<TInput, TOutput>(input: {
    /** The contract procedure to project. Its `~orpc.meta.access` access rules
     *  and its `.input()` zod schema are read verbatim; nothing is duplicated. */
    procedure: ContractProcedure<TInput, TOutput, unknown, unknown>;
    /** Model-facing description (procedures often lack good model prose). */
    description: string;
    /** Effect classification — REQUIRED, never inferred from the verb. */
    effect: AiToolEffect;
    /** Optional override of the auto-derived tool name (else `<plugin>.<proc>`). */
    name?: string;
    /** Optional dry-run for mutate/destructive projections. */
    dryRun?: AiTool<TInput, TOutput>["dryRun"];
  }, pluginMetadata: PluginMetadata): void;
}
export const aiToolProjectionExtensionPoint =
  createExtensionPoint<AiToolProjectionExtensionPoint>(
    "ai.toolProjectionExtensionPoint",
  );
```

`expose()` builds an `AiTool` by reading `procedure["~orpc"].meta.access`
(the same `ProcedureMetadata.access` `autoAuthMiddleware` reads at
[rpc.ts:120](../../core/backend-api/src/rpc.ts#L120)) into `requiredAccessRules`,
and `procedure["~orpc"].inputSchema` into `input`. Its `execute` calls the live
oRPC procedure through the existing in-process router with the resolved
principal as context — so the projected tool re-enters `autoAuthMiddleware`
and is re-checked handler-side (decision 5). **Effect is mandatory and explicit**
(`expose` throws at registration if omitted) — never inferred from
`operationType`, because a `mutation` operationType is not the same as a
destructive effect.

### 5.2 Resolver signature (principal → allowed tools, team-reach filtered)

```ts
// core/ai-backend/src/resolver.ts (NEW)
import type { AuthUser } from "@checkstack/backend-api";
import type { AiTool } from "@checkstack/ai-common";

export interface AiToolResolver {
  /**
   * The subset of registered tools the principal may see/call.
   * - A tool is allowed iff EVERY `requiredAccessRules` entry is satisfied by
   *   `principal.accessRules` (with the "*" admin escape — mirrors
   *   autoAuthMiddleware rpc.ts:259).
   * - Team-reach: tools whose underlying procedure is team-scoped
   *   (instanceAccess present) stay in the list; the per-call team filtering is
   *   enforced handler-side via the existing S2S checkResourceTeamAccess
   *   (router.ts:1743). The resolver does NOT pre-filter by team — it filters by
   *   the access-rule VOCABULARY only, so the surfaced toolset matches exactly
   *   what the principal could invoke in the UI.
   */
  resolveTools(principal: AuthUser): AiTool[];
  /** Single-tool authorization gate, called again at execute/apply time. */
  isAllowed(args: { principal: AuthUser; tool: AiTool }): boolean;
}
```

`isAllowed` is `tool.requiredAccessRules.every(r => rules.includes("*") || rules.includes(r))`
where `rules = principal.accessRules ?? []`. This is intentionally the SAME
predicate `autoAuthMiddleware` applies to `globalOnlyRules`
([rpc.ts:258-260](../../core/backend-api/src/rpc.ts#L258)) so a tool can never be
surfaced that the handler would then reject for a global rule. The handler S2S
team check remains the authority for instance rules.

### 5.3 Access rules (`core/ai-common/src/access.ts`)

```ts
import { access } from "@checkstack/common";
export const aiAccess = {
  chatUse: access("ai", "chat-use", "Use the in-app AI chat"),
  toolsManage: access("ai", "tools-manage", "Manage AI tool projections"),
  mcpManage: access("ai", "mcp-manage", "Manage MCP clients and DCR settings"),
};
export const aiAccessRules = [aiAccess.chatUse, aiAccess.toolsManage, aiAccess.mcpManage];
```

### 5.4 RPC contract (`core/ai-common/src/rpc-contract.ts`)

- `ai.chat.use`-gated: `listConversations`, `getConversation`, `sendMessage` (drives the server-side agent loop; streams via oRPC event-iterator), `proposeToolApply` / `confirmToolApply` (two-step).
- `ai.tools.manage`-gated: `listTools` (introspection — returns the resolver output for the caller), manage projections.
- `ai.mcp.manage`-gated: `listMcpClients` / `revokeMcpClient`, `getDcrSettings` / `setDcrSettings` (the DCR admin toggle + rate-limit config).
- Integration config reuses the standard integration-provider RPCs (test connection, set credentials) — nothing AI-specific.
- **No endpoint returns the integration's API key to the browser** (Secrets Vault masking applies, as with every integration). Asserted by a Phase-5 test (§16).

---

## 6. Bearer-JWT auth branch (`core/auth-backend/src/index.ts`)

### 6.1 Where it hooks in

The single seam is the `authenticationStrategyServiceRef.validate(request)`
callback at [core/auth-backend/src/index.ts:337](../../core/auth-backend/src/index.ts#L337).
Today it has two branches:
1. `Bearer ck_…` → `ApplicationUser` (`:345-439`).
2. else → better-auth session → `enrichUserLocal` → `RealUser` (`:441-450`).

Add a THIRD branch **between** them (after the `ck_` block returns/exits at
`:439`, before the session fallback at `:441`): a `Bearer <jwt>` branch.

```ts
// inside validate(request), after the ck_ branch:
const authHeader = request.headers.get("authorization");
if (authHeader?.startsWith("Bearer ") && !authHeader.startsWith("Bearer ck_")) {
  const token = authHeader.slice(7);
  const claims = await verifyOAuthAccessToken(token); // JWKS-verified (§6.2)
  if (!claims) return; // not our token / invalid -> falls through to session
  return await jwtPrincipalFromClaims(claims, db); // §6.3
}
```

This keeps `autoAuthMiddleware` ([rpc.ts:116](../../core/backend-api/src/rpc.ts#L116))
the single enforcement point: the JWT branch only PRODUCES a principal; all
authorization still runs in the middleware exactly as for `ck_` keys.

### 6.2 JWT verification

`verifyOAuthAccessToken(token)` verifies the RS256 signature against the AS's
JWKS. **Decided (§11): the better-auth `oidcProvider` plugin owns its own
signing keys and JWKS** (it ships this), so verification uses the plugin's
verifier / JWKS URL rather than the platform `keyStore`
([core/backend/src/services/keystore.ts](../../core/backend/src/services/keystore.ts)).
The existing `/.well-known/jwks.json` at
[index.ts:292](../../core/backend/src/index.ts#L292) stays for the platform's own
internal JWT use; the OAuth AS exposes its discovery + JWKS under the
better-auth mount. Verify: signature, `iss` = this AS, `aud` includes the MCP
resource, `exp`/`nbf`. Token introspection (revocation) is checked against the
`oidcProvider` token table when the token is opaque; for JWT access tokens we
accept short TTLs (§11) and rely on expiry.

### 6.3 Claims → principal variant

```ts
async function jwtPrincipalFromClaims(claims, db): Promise<RealUser | ApplicationUser> {
  // sub identifies the bound principal; the AS only ever issues tokens bound to
  // a real `user` or an `application` (decision 4).
  const { sub, principal_kind, scopes, team_ids } = claims; // narrowed at mint
  if (principal_kind === "user") {
    const base = await enrichUser(userRow(sub), db);   // utils/user.ts:11
    return { ...base, accessRules: scopes, teamIds: team_ids }; // NARROWED override
  }
  // application: same enrichment shape as the ck_ branch (index.ts:426-433)
  return {
    type: "application", id: sub, name: appName(sub),
    accessRules: scopes, teamIds: team_ids, roles: claims.roles ?? [],
  };
}
```

The crux: `enrichUser` (or the application enrichment) yields the principal's
FULL access rules; the JWT branch then **overrides** `accessRules` and `teamIds`
with the **narrowed** claim values minted into the token (§13). So the resulting
principal is a real principal that has been *narrowed* — `autoAuthMiddleware`
sees a smaller `accessRules`/`teamIds` set and enforces against it identically to
a UI session. The narrowing cannot widen because the mint-time intersection
(§13) only ever produces a subset (proven by §16 tests).

---

## 7. Scope narrowing (mint-time, `core/auth-backend`)

### 7.1 The algorithm

At token-mint time (the `oidcProvider` claims hook, §13.1), given:
- `requested: string[]` — scopes the client asked for (raw access-rule ids
  and/or bundle ids, §12).
- the bound principal (a `user` or `application`), from which we resolve, via the
  SAME machinery the UI uses:
  - `principalRules = enrichUser(...).accessRules` (admin → `["*"]`,
    [utils/user.ts:30](../../core/auth-backend/src/utils/user.ts#L30)), and
  - `principalTeams = ...teamIds`.

Compute:
```
expanded   = expandBundles(requested)            // §12 bundle layer
candidate  = expanded ∩ effectiveRules(principalRules)
             where effectiveRules("*") = the full registered access-rule set
narrowed   = candidate                            // never adds anything
teamClaim  = principalTeams                        // tokens inherit the principal's team reach as-is
```

- **Admin special case:** if `principalRules` contains `"*"`, `effectiveRules`
  is the complete registered access-rule catalog (so an admin can mint a token
  for any requested rule, but still ONLY the rules they explicitly requested —
  the token is still narrowed to `requested`, never auto-granted `"*"`). The
  minted token never carries `"*"`; it carries the concrete expanded set. This
  prevents a leaked admin token from being a god-token.
- **Narrow-only invariant:** `narrowed ⊆ principalRules` (modulo the admin
  expansion) by set-intersection construction. There is NO path that adds a rule
  the principal lacks. This is the property §16 fuzz-tests.
- **No parallel ACL:** the only source of truth is the principal's real rules;
  the token is a *projection* of them. There is no separate scope grant table to
  drift (decision 4).
- **Team reach:** the token inherits `principalTeams` verbatim; per-resource
  team checks still run handler-side (S2S `checkResourceTeamAccess`,
  [router.ts:1743](../../core/auth-backend/src/router.ts#L1743)). We do NOT let a
  client request a team subset in v1 (scopes are access-rule ids, not team ids);
  team narrowing is a future extension flagged in §17.

### 7.2 The exact claims hook used

Decided in §11: better-auth `oidcProvider` exposes a payload/claims
customization callback at token issuance. The narrowing runs there, writing the
custom claims `{ principal_kind, scopes, team_ids, roles }` onto the access
token. The precise callback name is pinned in the §11 spike (the one real
Phase-2 code probe), but the design above is callback-API-agnostic: wherever the
hook lands, it receives the bound session/user and the requested scopes, and
returns the narrowed claim set.

---

## 8. Effect / confirmation + the flagship automation flow

- **Read tools** auto-run: resolver gate → `execute` → `ai_tool_calls` row with
  `status = "executed"`.
- **Mutate/destructive** use propose→apply:
  1. `propose(toolName, input)`: resolver gate + `isAllowed` re-check → `dryRun`
     (reusing `collectDefinitionIssues`
     [validate-definition.ts:46](../../core/automation-backend/src/validate-definition.ts#L46)
     and `renderConfig`
     [render.ts:78](../../core/automation-backend/src/dispatch/render.ts#L78)) →
     persist a `proposed` row (token, nonce, TTL, `proposedPayload`) → return the
     preview + token. **No mutation yet.**
  2. `apply(token)`: parse + validate the token (§13.4), re-check `isAllowed`
     (the principal's rules may have changed), re-validate the payload, then
     `execute` → transition the row to `applied`. Chat renders a confirm card
     between the two steps; MCP returns the proposal for a follow-up `apply` call.
- **Flagship `automation.propose`** (a hand-authored composite tool via
  `aiToolExtensionPoint`): NL → the tool builds a draft automation definition,
  runs `validateDefinition` (the dry-run), and returns the validated draft YAML +
  a proposal token. In chat, the confirm card deep-links into the existing
  collapsed-card editor at
  [core/automation-frontend/src/editor/](../../core/automation-frontend/src/editor/),
  seeded with the draft; the human reviews and applies. The AI never silently
  creates an automation (decision 6).

---

## 9. MCP server surface (Phase 2/3)

- **Transport:** Streamable HTTP, mounted via `pluginHttpHandlers`
  ([plugin-manager.ts:35](../../core/backend/src/plugin-manager.ts#L35)) under
  `/api/ai/mcp` (qualified by plugin id). The live connection registry is
  pod-local bookkeeping (`declareNonReactiveState({ reason: "bookkeeping" })`,
  decision 9) — same exception class as the satellite WebSocket map.
- **Auth:** the better-auth `mcp` plugin's `withMcpAuth` wraps the handler;
  the validated OAuth token flows into the JWT branch (§6) to produce a narrowed
  principal.
- **Tools:** the resolver output (§5.2), serialized to MCP tool defs via
  `toJsonSchema()` ([schema-utils.ts:100](../../core/backend-api/src/schema-utils.ts#L100)).
- **Resources** (decided §11: derived, not hand-authored): expose read-only
  entity context — incidents, health-checks, anomalies — as MCP resources by
  reusing the same projected read procedures the tools use, rendered as resource
  reads. A small hand-authored *index* resource lists what's available; the
  per-item reads are derived from the existing list/get procedures so they can
  never drift from the live data or skip authz (every read re-enters
  `autoAuthMiddleware`).
- **Prompts:** a small hand-authored set (e.g. "draft an automation for X",
  "summarize open incidents for system Y") — these are curated UX, not derivable.

---

## 10. Audit + hooks

- Every invocation writes an `ai_tool_calls` row (§4). `argsHash` is a SHA-256 of
  canonical-JSON args (raw args never stored — may carry PII/secrets).
- Emit `ai.toolCalled` (a `createHook` in `ai-common`) carrying
  `{ principalKind, principalId, transport, toolName, effect, status }` (no args,
  no result body) so subscribers (e.g. notification, anomaly-context) can react
  without seeing payloads.
- The audit table doubles as the proposal-token store (§4, §13.4).

---

## 11-14. Resolved open items (was §9 "to confirm")

> Each of the 6 open items is converted to a DECIDED design + rationale, or an
> explicit SPIKE task where a code prototype is genuinely required first.

### 11. better-auth `oidcProvider`/`mcp` version + claims-hook API at 1.4.7 — SPIKE (the one real probe)

**Decision: keep as a tightly-scoped Phase-2 spike, because it is the single
fact that cannot be settled by reading the Checkstack repo — it depends on the
exact `better-auth@1.4.7` plugin API surface.** Both `auth-backend` and `backend`
pin `better-auth@^1.4.7`
([core/auth-backend/package.json](../../core/auth-backend/package.json),
[core/backend/package.json](../../core/backend/package.json)).

Spike deliverable (timeboxed, ~½ day, lands as a throwaway branch + a findings
note appended to this section):
1. Confirm `oidcProvider` + `mcp` exist and are mutually compatible at 1.4.7.
2. Pin the exact claims/payload-customization callback (name + signature) used in
   §7.2 and the `withMcpAuth` wrapper signature used in §9.
3. Confirm whether `oidcProvider` issues JWT or opaque access tokens at 1.4.7 and
   whether it ships its own JWKS (assumed yes in §6.2). If opaque, the §6.2
   verifier becomes an introspection call instead of a JWKS verify — the §6
   branch design is unaffected (it abstracts behind `verifyOAuthAccessToken`).
4. Confirm consent-screen + DCR toggle hooks.

Everything else in §6/§7/§9 is API-shape-agnostic by construction, so the spike
only pins names, not architecture. **DECISION (key store):** the `oidcProvider`
plugin owns the AS signing keys/JWKS; the platform `keyStore` is untouched.

### 12. Scope grammar: raw IDs vs bundles — LOCKED (maintainer 2026-06-01): raw access-rule IDs + the `checkstack:read` / `checkstack:write` two-bundle layer

- Scope strings ARE qualified access-rule ids (the same vocabulary
  `autoAuthMiddleware` enforces and `aiAccess`/`automationAccess` define, e.g.
  `automation:read`). This is the narrow-only single-source-of-truth (decision 4).
- A **thin curated bundle layer** maps a handful of memorable umbrella scopes to
  sets, expanded at mint time (`expandBundles` in §7.1):
  - `checkstack:read` → all `*:read` rules currently registered.
  - `checkstack:write` → all `*:read` + `*:manage` rules.
  Bundles are expanded BEFORE intersection, so a bundle can still only narrow:
  `checkstack:write ∩ principalRules` yields only what the principal already has.
- **Rationale:** raw ids keep the model honest (no drift), bundles keep DCR
  clients ergonomic. Bundles are derived from the live access-rule catalog (never
  a hand-maintained list), so they can't go stale.

### 13. MCP resources derived vs hand-authored — DECIDED: derived (with a hand-authored index)

See §9. Per-item resource reads are derived from existing read procedures so
they re-use authz and never drift; only the top-level index + the prompt set are
hand-authored (curation, not data).

### 13.4 Proposal-token TTL + storage — LOCKED (maintainer 2026-06-01): row in `ai_tool_calls`, 10-minute TTL

- **Storage:** the `proposed` audit row IS the token store (no separate ephemeral
  table). Token = `propose:<rowId>.<nonce>` (base64url); `proposalNonce` 32 random
  bytes; `proposalExpiresAt = now + TTL`.
- **TTL:** 10 minutes (LOCKED). Long enough for a human confirm card; short
  enough to bound replay. Configurable per-instance later; 10 min is the shipped
  default.
- **Apply check:** fetch by id → `status === "proposed"` AND constant-time nonce
  match AND `proposalExpiresAt > now`; else reject (`409`/`410`). On success,
  transition `proposed → applied` in one `UPDATE … WHERE status='proposed'`
  (atomic single-use — a second `apply` finds `status !== 'proposed'` and is
  rejected, so the token is single-use even under concurrent calls).
- **Sweep:** a background job flips expired `proposed` rows to `expired`
  (§14.5), retaining them as audit history.

### 14.5 Rate-limit store under horizontal scale — DECIDED: shared Postgres counter (NOT in-memory)

- **The state-and-scale answer:** rate-limit + budget counters live in Postgres,
  so every pod reads/writes the same counter (decision 9; required by
  [.agent/rules/state-and-scale.md](../rules/state-and-scale.md)). An in-memory
  per-pod limiter would let N pods each allow the limit → N× the intended cap,
  which a single-process test would never catch — explicitly rejected.
- **Implementation:** a fixed-window counter table
  `ai_rate_limits(key text, window_start timestamp, count int, primary key(key, window_start))`
  with an atomic `INSERT … ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count`.
  `key` is `${principalKind}:${principalId}:${bucket}` (tool-budget bucket) or
  `dcr:${clientIp}` (DCR throttle). A Hono middleware fronts the DCR endpoint and
  the tool-call entry points. (The `ai_tool_calls.principalCreatedIdx` also
  supports a rolling-window count if a sliding window is preferred later — the
  fixed-window table is the shipped v1.)
- **LLM spend cap (optional, per-org):** a counter keyed `spend:${orgId}` updated
  with token-usage cost after each agent turn; over-cap returns a friendly error.
  **Off by default (LOCKED, maintainer 2026-06-01); the config knob exists and is
  opt-in per integration.**

### 14.6 Default model + per-integration model UX — DECIDED

- The OpenAI-compatible integration `connectionSchema` (a `Versioned<T>`, §4)
  carries: `baseUrl` (default `https://api.openai.com/v1`), `apiKey` (`x-secret`),
  `defaultModel` (string), and an optional `availableModels` allowlist.
- **Default model:** the connection's `defaultModel` is used unless a conversation
  overrides it. No platform-wide hardcoded default model (providers differ);
  `defaultModel` is a required field on the connection.
- **Per-integration model selection UX:** the chat UI shows a model picker
  populated from `availableModels` (or a free-text field when the allowlist is
  empty), defaulting to `defaultModel`. The picked model is stored on
  `ai_conversations.integrationId` context + the message metadata.
- **Rationale:** model choice is a property of the credential/provider, so it
  lives on the integration connection (reusing `DynamicForm`), not a separate
  global setting. This matches the integration-provider pattern
  ([provider-types.ts:75](../../core/integration-backend/src/provider-types.ts#L75)).

---

## 15. Docs deliverable (`docs/src/content/docs/developer-guide/ai/`)

A NEW `ai/` section under
[docs/src/content/docs/developer-guide/](../../docs/src/content/docs/developer-guide/)
(no AI docs exist today; top-level docs sections are only `developer-guide` and
`user-guide`). Each page has Starlight frontmatter (`title:` + one-sentence
`description:`), sentence-case headings, no in-body H1, slug-based cross-links
(`/checkstack/developer-guide/ai/<slug>/`), runnable code/contract snippets, and
no em-dashes (per [.agent/rules/docs-style.md](../rules/docs-style.md)). Shipped
per-phase alongside the code that introduces each surface:

| Page | Ships in | Content |
|---|---|---|
| `ai/index.mdx` | Phase 1 | AI platform overview; one-registry-two-transports architecture; package map. |
| `ai/tool-registry.md` | Phase 1 | `AiTool` contract; `aiToolExtensionPoint.registerTool` + `aiToolProjectionExtensionPoint.expose` signatures + examples; effect classification; the resolver. |
| `ai/oauth-and-scopes.md` | Phase 2 | Checkstack as OAuth AS; scope = access-rule id grammar + bundles; the narrow-only algorithm; the JWT auth branch; DCR + consent. |
| `ai/mcp-server.md` | Phase 2/3 | MCP server discovery URL + Streamable-HTTP transport; the tool / resource / prompt surface; how to connect Claude/Cursor; auth flow. |
| `ai/propose-apply.md` | Phase 3 | Effect classification; two-step propose→apply token; the flagship `automation.propose` flow into the editor. |
| `ai/chat.md` | Phase 4 | Server-side agent loop; conversation persistence; context seeding; confirm cards; per-integration model UX. |

Architectural changes that touch a public contract MUST ship the matching doc
page in the SAME PR ([.agent/rules/architecture.md](../rules/architecture.md)).

---

## 16. Per-phase test matrix

> TDD throughout (`bun test`, [.agent/rules/testing.md](../rules/testing.md)).
> The security invariants below are the §1/§3 hardening goals turned into
> concrete, named assertions. Each is a regression guard.

| # | Phase | File (suggested) | Target | Assertion |
|---|---|---|---|---|
| 1 | 1 | `core/ai-backend/src/resolver.test.ts` | resolver `resolveTools` | A principal lacking `automation:manage` never sees `automation.propose`; an admin (`accessRules:["*"]`) sees all tools. |
| 2 | 1 | `core/ai-backend/src/resolver.test.ts` | `isAllowed` ≡ middleware | For a matrix of (rules, tool.requiredAccessRules), `isAllowed` returns exactly what `autoAuthMiddleware`'s global-rule check would (mirrors rpc.ts:258-260). |
| 3 | 1 | `core/ai-backend/src/projection.test.ts` | `expose()` | A projected tool's `requiredAccessRules` equals the source procedure's `~orpc.meta.access`; `expose` throws if `effect` omitted. |
| 4 | 1 | `core/ai-backend/src/serializer.test.ts` | tool serializer | `toJsonSchema()` output for a tool input matches the same procedure's OpenAPI schema (no second serializer drift). |
| 5 | 2 | `core/auth-backend/src/scope-narrowing.test.ts` | `narrow()` (§7) | **Property/fuzz:** for any `requested` and any `principalRules`, `narrowed ⊆ principalRules` (admin-expanded) — narrowing can NEVER widen. |
| 6 | 2 | `core/auth-backend/src/scope-narrowing.test.ts` | bundle expansion | `checkstack:write ∩ principalRules` never yields a rule the principal lacks; bundles derive from the live catalog. |
| 7 | 2 | `core/auth-backend/src/jwt-branch.test.ts` | §6.3 | A JWT with narrowed `scopes` produces a principal whose `accessRules` equals the claim (NOT the principal's full rules); a forged/expired token returns `undefined` (falls through, not authenticated). |
| 8 | 2 | `core/ai-backend/src/mcp-auth.test.ts` | MCP authz | An MCP call for a tool outside the token's scopes is rejected by `autoAuthMiddleware`, not just hidden by the resolver (handler-side authz holds when the model misbehaves). |
| 9 | 2 | `core/ai-backend/src/mcp-conformance.it.test.ts` | MCP wire | Streamable-HTTP initialize/list-tools/call round-trips against the SDK conformance expectations (env-gated `*.it.test.ts`). |
| 10 | 2 | `core/auth-backend/src/dcr-ratelimit.it.test.ts` | DCR throttle (§14.5) | N rapid DCR registrations from one IP hit the shared-Postgres limit; the limit holds when the counter is read from a second simulated pod (scale-correctness). |
| 11 | 3 | `core/ai-backend/src/propose-apply.test.ts` | token lifecycle (§13.4) | A valid token applies once; a second apply is rejected (single-use); an expired token is rejected; a tampered nonce is rejected (constant-time compare). |
| 12 | 3 | `core/ai-backend/src/propose-apply.test.ts` | dry-run reuse | `automation.propose` returns a validated draft via `collectDefinitionIssues` WITHOUT mutating; no automation row is created until `apply`. |
| 13 | 3 | `core/ai-backend/src/audit.test.ts` | `ai_tool_calls` | Every transport/effect path writes the expected status; `argsHash` is a hash, raw args are never persisted. |
| 14 | 4 | `core/ai-backend/src/agent-loop.test.ts` | chat loop | The loop only offers resolver-allowed tools; a model-requested tool outside the set is refused server-side. |
| 15 | 4 | `core/ai-backend/src/conversation-store.test.ts` | persistence | A conversation written by one (simulated) pod is fully readable by another — no pod-local chat state (state-and-scale). |
| 16 | 5 | `core/ai-backend/src/no-secret-leak.test.ts` | DTO hygiene | No RPC/DTO/MCP response ever returns the integration `apiKey` or any `x-secret` field; chat message persistence masks secrets. |
| 17 | 5 | `core/ai-backend/src/ratelimit.it.test.ts` | per-principal budget | Over-budget tool calls are rejected; the counter is shared across pods (Postgres), not per-pod. |

Integration-only assertions (#9, #10, #17) follow the exemplar's `*.it.test.ts`
env-gated convention (`CHECKSTACK_IT=1`) so the default `bun test` stays fast.

---

## 17. Phasing

> Each phase is an independently shippable PR with its own changeset
> (beta = **minor** bump; `BREAKING CHANGES:` in the changeset body for any
> contract move — [.agent/rules/changesets.md](../rules/changesets.md)), tests
> (§16), and docs (§15) in the SAME PR. This expanded plan is intended to be
> trivially spawnable as one tracking issue per phase.

1. **Phase 1 — spine + integration.** `core/ai-common` + `core/ai-backend`
   skeleton; `aiToolExtensionPoint` + `aiToolProjectionExtensionPoint` (§5.1);
   resolver (§5.2); zod→JSON-Schema tool serializer (wrap `toJsonSchema()`); the
   OpenAI-compatible Integration provider + Settings UI (`core/ai-frontend`,
   §14.6). A handful of read-only tools registered (`incident.list/summarize`,
   `healthcheck.status`, `anomaly.explain`) — projected via `expose()` where a
   procedure exists. *Run `typecheck:references:generate` (new packages + deps).*
   *Docs:* `ai/index.mdx`, `ai/tool-registry.md`. *Tests:* #1-#4.
2. **Phase 2 — OAuth AS + MCP server (read-only).** SPIKE first (§11). Enable
   better-auth `oidcProvider` + `mcp` in `auth-backend`; claims hook + scope
   narrowing (§7); the bearer-JWT branch in the auth strategy (§6);
   Streamable-HTTP MCP endpoint (§9) exposing read-only tools + resources/prompts;
   consent screen; DCR toggle + Postgres-backed rate-limit (§14.5).
   **Validate end-to-end against a real external client (Claude/Cursor).**
   *Docs:* `ai/oauth-and-scopes.md`, `ai/mcp-server.md`. *Tests:* #5-#10.
3. **Phase 3 — mutating tools + propose/apply + audit.** Effect classification;
   two-step propose→apply (§8, §13.4) reusing `validateDefinition`/`renderConfig`;
   the flagship `automation.propose` into the editor; `ai_tool_calls` audit table
   + `ai.toolCalled` hook (§4, §10); per-principal rate-limit budgets (§14.5).
   *Docs:* `ai/propose-apply.md`. *Tests:* #11-#13.
4. **Phase 4 — internal chat.** Server-side Vercel AI SDK agent loop on the same
   registry (principal = logged-in user); conversation persistence
   (`ai_conversations`/`ai_messages`); streaming chat UI; context-aware seeding;
   confirm cards; per-integration model UX (§14.6). *Docs:* `ai/chat.md`.
   *Tests:* #14-#15. Any new `@checkstack/ui` component gets a Storybook story.
5. **Phase 5 — docs polish + hardening.** Security tests (#16-#17: scope
   narrowing can never widen; handler-side authz holds when the model misbehaves;
   no secret crosses a DTO), MCP conformance, rate-limit/DCR abuse tests; finalize
   all `ai/` docs pages and changesets.

---

## 18. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Model calls a tool the principal can't use | Resolver only surfaces allowed tools (§5.2) AND each handler re-checks via `autoAuthMiddleware` ([rpc.ts:116](../../core/backend-api/src/rpc.ts#L116)); model is untrusted (§1.5). Test #8, #14. |
| OAuth scope widens privileges | Scopes = access-rule ids intersected with the real principal's rules + teams at mint (§7); narrow-only; single enforcement path; no parallel ACL. Property-test #5, #6. |
| Cross-pod chat continuity / rate-limit miscount | Conversations/messages + rate-limit counters in Postgres (§4, §14.5); only the live MCP connection registry is pod-local (`declareNonReactiveState`). Test #15, #17. |
| Destructive tool runs without consent | Effect classification + two-step propose→apply token (§8, §13.4); chat confirm card; MCP follow-up `apply`; single-use token. Test #11. |
| AI silently mutates automations | `automation.propose` produces a validated draft into the existing editor; human applies (§8). Test #12. |
| Integration API key leaks | Stored in Secrets Vault (`x-secret`); never returned to browser; existing masking. Test #16. |
| Open DCR endpoint abuse | Admin toggle + shared-Postgres rate-limit (§14.5); clients listable/revocable. Test #10. |
| LLM cost runaway | Per-org spend cap + per-principal tool budgets (§14.5); model selection per integration (§14.6). |
| Projecting too many procedures floods the model | Opt-in projection only (decision 2); curated composite tools where a coarser surface is needed. |
| better-auth provider plugin ↔ custom RBAC mismatch | Claims hook is the single seam (§7.2); RBAC truth stays in the custom tables; the §11 spike pins the hook ergonomics before any wiring. |
| better-auth 1.4.7 API differs from assumption | §6/§7/§9 are API-shape-agnostic (abstracted behind `verifyOAuthAccessToken`, `expandBundles`, the claims hook); the §11 spike only pins names, never architecture. |

---

## 19. Cross-cutting (repo rules)

- TDD (`bun test`), no `any`, no `eslint-disable`, zod 4, typed object args
  ([.agent/rules/code-style-guide.md](../rules/code-style-guide.md)).
- **Run `bun run typecheck:references:generate` and commit the tsconfig changes**
  when the new packages (`core/ai-common`, `core/ai-backend`, `core/ai-frontend`)
  and their `@checkstack/*` / better-auth / `@ai-sdk` deps land — per
  [.agent/rules/typecheck.md](../rules/typecheck.md). Skipping this fails the
  `typecheck:references:check` CI job.
- `bun run lint` + `bun run typecheck` from root before any phase is done.
- Changesets per package (beta = **minor**, never major; `BREAKING CHANGES:` in
  the body where contracts move — [.agent/rules/changesets.md](../rules/changesets.md)).
  No changeset for THIS plan-doc expansion (internal `.agent/` change).
- Docs under `docs/src/content/docs/developer-guide/ai/` in the SAME phase as the
  code that introduces each surface (§15) — Starlight frontmatter, no em-dashes,
  slug-based links.
- Storybook story for any new `@checkstack/ui` component (Phase 4 chat UI).
- **State-and-scale answer (required in each phase's changeset/PR,
  [.agent/rules/state-and-scale.md](../rules/state-and-scale.md)):**
  1. **Where state lives:** conversations, messages, tool-call audit, proposal
     tokens, and rate-limit counters are all Postgres tables in the `ai-backend`
     plugin schema. OAuth client/token state lives in the `oidcProvider`-owned
     tables.
  2. **Same answer on every pod:** yes — every read hits shared Postgres; no
     reactive/queryable AI state is pod-local.
  3. **Pod-local exception:** only the live MCP/Streamable-HTTP connection
     registry, marked `declareNonReactiveState({ reason: "bookkeeping" })` (never
     a source of truth) — same exception class as the existing WebSocket registry.

## 20. Decision log + the one remaining heads-up

All three previously-open policy knobs are now LOCKED (maintainer 2026-06-01):
- **Scope grammar (§12):** raw access-rule IDs + the `checkstack:read` /
  `checkstack:write` two-bundle layer (expanded before intersection, narrow-only).
- **Proposal-token TTL (§13.4):** 10 minutes.
- **LLM spend cap (§14.6):** off by default; the config knob exists.

Remaining informational heads-up (not a knob — surfaces from the one scoped spike):
- **§11 spike outcome may pin the OAuth token as opaque (introspection) rather
  than JWT.** The §6 branch absorbs this, but it changes the verification cost
  profile (an introspection round-trip per call vs a local JWKS verify). Note for
  review once the spike lands.
