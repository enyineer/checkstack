import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * AI platform — Phase 3 data model (Drizzle).
 *
 * Phase 3 introduces ONE durable table, `ai_tool_calls`, which serves two
 * purposes at once (decision §4, §13.4):
 *
 *  1. An append-only **audit log** for every AI tool invocation across both
 *     transports (chat + MCP), regardless of effect.
 *  2. The **propose/apply token store**. A `proposed` row IS the token: the
 *     opaque token handed to the caller is `propose:<rowId>.<nonce>`; `apply`
 *     looks the row up by id, checks the nonce + TTL + status, then transitions
 *     it to `applied` in a single atomic UPDATE (single-use even under
 *     concurrent applies). There is no separate ephemeral table.
 *
 * State & scale (.claude/rules/state-and-scale.md): this is a shared-Postgres
 * table, so every pod reads/writes the same audit + token store. A token
 * proposed on pod A is consumable on pod B; an expired token is rejected on any
 * pod. No proposal/audit state is pod-local.
 *
 * Phase 4 adds the chat surface: `ai_conversations` + `ai_messages` (durable,
 * continuable from any pod — state-and-scale §9) and the `ai_message_role` enum.
 * `ai_tool_calls.conversationId` now carries the deferred FK to
 * `ai_conversations` (set null on delete, so audit history outlives a deleted
 * chat).
 */

import { pgEnum } from "drizzle-orm/pg-core";

/** Which transport drove the tool call. */
export const aiTransportEnum = pgEnum("ai_transport", [
  "chat",
  "mcp",
  "automation",
]);

/**
 * Per-conversation permission mode (Phase 4). Durable (not pod-local) so a read
 * returns the same answer on every pod. Governs the `mutate` tool branch only;
 * destructive tools always require a human apply regardless of this value.
 */
export const aiPermissionModeEnum = pgEnum("ai_permission_mode", [
  "approve",
  "auto",
]);

/** Effect classification mirrored from the `AiTool` descriptor. */
export const aiToolEffectEnum = pgEnum("ai_tool_effect", [
  "read",
  "mutate",
  "destructive",
]);

/** Role of a persisted chat message (AI-SDK roles). */
export const aiMessageRoleEnum = pgEnum("ai_message_role", [
  "system",
  "user",
  "assistant",
  "tool",
]);

/**
 * Scope of an `ai_memory` row. `user` = a private preference/policy owned by the
 * saving principal; `system` = a durable fact about one catalog system, readable
 * by anyone who can read that system.
 */
export const aiMemoryScopeEnum = pgEnum("ai_memory_scope", ["user", "system"]);

/** Lifecycle of an `ai_tool_calls` row. */
export const aiToolCallStatusEnum = pgEnum("ai_tool_call_status", [
  "proposed", // dry-run done, token issued, awaiting apply
  "applied", // apply consumed the proposal token and committed
  "executed", // read tool ran directly (no proposal step)
  "failed", // execute / apply threw
  "expired", // proposal token TTL elapsed before apply
  "rejected", // human declined the confirm card / apply never called
]);

/**
 * A durable chat conversation, continuable from any pod (state-and-scale §9).
 * Owned by a single RealUser; no FK to the auth plugin's user table
 * (cross-plugin tables are not FK-linked in this codebase) — ownership is
 * enforced at the handler via the session principal.
 */
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Owning real user id (chat is RealUser-only). */
    userId: text("user_id").notNull(),
    title: text("title"),
    /** Qualified integration connection id used for this conversation. */
    integrationId: text("integration_id"),
    /** Model id selected for this conversation (defaults to the connection's). */
    model: text("model"),
    /**
     * Per-conversation permission mode (Phase 4). Durable + shared-Postgres so a
     * turn handled on any pod reads the SAME mode. Governs the `mutate` tool
     * branch only (`auto` auto-applies a mutate proposal server-side; `approve`
     * surfaces a confirm card). Reads always run and destructive tools always
     * require a human apply, regardless of this column. Safe-by-default `approve`.
     */
    permissionMode: aiPermissionModeEnum("permission_mode")
      .notNull()
      .default("approve"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    /**
     * Soft-delete marker (Phase 7). The user-facing "Delete" action ARCHIVES a
     * conversation by stamping this column rather than hard-deleting the row, so
     * the transcript is retained for later abuse introspection. `listConversations`
     * filters `archivedAt IS NULL`, so archived chats disappear from the sidebar
     * but the rows (and their messages) live on. Null = active.
     */
    archivedAt: timestamp("archived_at"),
  },
  (t) => ({
    userIdx: index("ai_conversations_user_idx").on(t.userId, t.updatedAt),
  }),
);

/** Append-only message log for a conversation. */
export const aiMessages = pgTable(
  "ai_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: aiMessageRoleEnum("role").notNull(),
    /** AI-SDK message parts: text + tool-call / tool-result parts. Secrets are
     *  masked before persist (see `scrubContent`). */
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    /** Tool calls emitted by an assistant turn (denormalized for fast render). */
    toolCalls: jsonb("tool_calls").$type<Array<Record<string, unknown>>>(),
    /**
     * Tool-call REPLAY (additive, Phase 6): the canonical AI-SDK
     * `ResponseMessage[]` (assistant tool-call parts + tool-result parts) the
     * model produced this turn. Stored verbatim (after secret-scrubbing) so a
     * RESUMED multi-turn conversation replays the full prior tool interaction to
     * the model — not just the rendered text. Null for plain user/system rows
     * and for legacy assistant rows written before this column existed (those
     * fall back to text-only replay). Shared Postgres, so replay is identical on
     * whichever pod handles the next turn (state-and-scale §9).
     */
    modelMessages: jsonb("model_messages").$type<Array<Record<string, unknown>>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    convIdx: index("ai_messages_conversation_idx").on(
      t.conversationId,
      t.createdAt,
    ),
  }),
);

export const aiToolCalls = pgTable(
  "ai_tool_calls",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** "user" | "application" — never "service" (services bypass the registry). */
    principalKind: text("principal_kind").notNull(),
    principalId: text("principal_id").notNull(),
    transport: aiTransportEnum("transport").notNull(),
    /** Optional link back to a chat turn (null for MCP). Phase 4 deferred FK. */
    conversationId: text("conversation_id").references(
      () => aiConversations.id,
      { onDelete: "set null" },
    ),
    toolName: text("tool_name").notNull(),
    effect: aiToolEffectEnum("effect").notNull(),
    /** SHA-256 of the canonical-JSON args (never the raw args — may hold PII). */
    argsHash: text("args_hash").notNull(),
    status: aiToolCallStatusEnum("status").notNull(),
    /** Propose/apply token nonce (random 32 bytes hex). Null for read tools. */
    proposalNonce: text("proposal_nonce"),
    /** Hard expiry of a `proposed` row (now + TTL, §13.4). */
    proposalExpiresAt: timestamp("proposal_expires_at"),
    /**
     * WHO applied the proposal (P3 review item 1). The proposer is recorded in
     * `principalKind`/`principalId`; these two columns record the principal that
     * actually consumed the token at `apply` time. They are normally identical,
     * but the propose/apply security invariant (single-use, 256-bit secret
     * token, live authz re-check) holds regardless of caller identity, so a
     * cross-principal apply is RECORDED rather than rejected — the audit log must
     * never silently attribute an apply to the wrong principal. Null until apply.
     */
    appliedByKind: text("applied_by_kind"),
    appliedById: text("applied_by_id"),
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
    // Per-principal budget counter window scan + audit listing.
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

/**
 * Per-integration LLM SPEND LEDGER (Phase 6, the locked-off spend-cap knob).
 *
 * An append-only token-usage ledger: ONE row per completed chat turn, keyed by
 * the integration connection AND the principal, carrying the AI-SDK token usage
 * (`inputTokens` + `outputTokens` -> `totalTokens`) for that turn. The optional
 * per-integration spend cap is a ROLLING-WINDOW SUM over this table, mirroring
 * the per-principal tool rate-limit budget exactly:
 *
 *  - State lives in shared Postgres, so the cap is COUNTED ACROSS ALL PODS. An
 *    in-memory per-pod token counter would let N pods each allow the cap = N x
 *    the intended spend — a leak a single-process test can never catch
 *    (state-and-scale §14.5). Every pod sums the SAME table.
 *  - Token-count (not USD) is deliberate: it is deterministic and provider-
 *    agnostic. OpenAI-compatible endpoints span OpenAI, Azure, OpenRouter,
 *    Ollama, vLLM, LM Studio — there is no single price table, and self-hosted
 *    models have no per-token price at all. Tokens are the one unit every
 *    provider reports via the AI SDK's `usage`.
 *  - The cap is OFF by default: no cap is enforced unless the connection
 *    configures `spendCap`.
 */
export const aiSpend = pgTable(
  "ai_spend",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Qualified integration connection id the spend was incurred against. */
    integrationId: text("integration_id").notNull(),
    /** "user" | "application" — the principal that incurred the spend. */
    principalKind: text("principal_kind").notNull(),
    principalId: text("principal_id").notNull(),
    /** Optional link back to the conversation (audit; null-safe). */
    conversationId: text("conversation_id"),
    /** Model id the turn ran against. */
    model: text("model"),
    /** Prompt (input) tokens for the turn. */
    inputTokens: integer("input_tokens").notNull().default(0),
    /** Completion (output) tokens for the turn. */
    outputTokens: integer("output_tokens").notNull().default(0),
    /** input + output, persisted so the window SUM is a single indexed column. */
    totalTokens: integer("total_tokens").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // Rolling-window SUM scan: filter by integration + principal + createdAt.
    windowIdx: index("ai_spend_integration_principal_created_idx").on(
      t.integrationId,
      t.principalKind,
      t.principalId,
      t.createdAt,
    ),
  }),
);

/**
 * Durable "operator memory" the assistant saves and recalls across conversations
 * (state-and-scale §9: shared Postgres, readable on every pod). Holds only
 * knowledge the platform does NOT otherwise store — operator preferences/policies
 * (`user` scope) and durable facts about a system (`system` scope) — never a
 * cache of live state (health/incident/SLO), which is always queried live.
 *
 * Scoping is the enforcement surface: `user` memories are private to `ownerId`;
 * `system` memories are readable by anyone who can read `systemId` (gated at the
 * store/handler via the per-system access resolver), with `ownerId` retained for
 * attribution. No FK to the catalog (cross-plugin tables are not FK-linked).
 */
export const aiMemory = pgTable(
  "ai_memory",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Principal id that created the memory (attribution + `user`-scope owner). */
    ownerId: text("owner_id").notNull(),
    scope: aiMemoryScopeEnum("scope").notNull(),
    /** Catalog system id; set iff `scope = "system"`. */
    systemId: text("system_id"),
    /** "What this is + when to recall it" — the rankable retrieval index. */
    recallHint: text("recall_hint").notNull(),
    /** The actual note. Secret-scrubbed on the write path. */
    content: text("content").notNull(),
    /**
     * When true, this memory is prepended to the chat system prompt EVERY turn
     * (an always-apply preference, e.g. a writing-style rule) instead of only
     * being surfaced when the model chooses to recall it. The model proposes the
     * value; the operator can change it. Default false = recall-on-demand.
     */
    alwaysInject: boolean("always_inject").notNull().default(false),
    tags: jsonb("tags").$type<string[]>(),
    /** Conversation the memory was saved from (provenance; null-safe). */
    sourceConversationId: text("source_conversation_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    ownerIdx: index("ai_memory_owner_idx").on(t.ownerId, t.updatedAt),
    systemIdx: index("ai_memory_system_idx").on(t.systemId, t.updatedAt),
  }),
);

/**
 * User-authored AI "skills" (reusable prompt templates). GLOBAL: a skill is
 * visible to every principal that can read skills (no per-user/per-system
 * scoping), with `ownerId` retained for attribution + edit/delete authority.
 * Builtin skills live in code (not this table). Shared Postgres, identical on
 * every pod (state-and-scale §9). No FK (cross-plugin tables are not FK-linked).
 */
export const aiSkill = pgTable(
  "ai_skill",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Principal id that authored the skill (attribution + edit/delete owner). */
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    /** Surfaces the skill targets: subset of ["chat","ai_analyze"]. */
    targets: jsonb("targets").$type<string[]>().notNull(),
    /** Instruction fragment folded into the system prompt. Scrubbed on write. */
    systemPrompt: text("system_prompt"),
    /** Starter prompt seeded into the composer / analyze prompt. Scrubbed on write. */
    promptTemplate: text("prompt_template"),
    /** Suggested ai_analyze output fields ({key,type,description,options?}). */
    suggestedOutputFields:
      jsonb("suggested_output_fields").$type<Array<Record<string, unknown>>>(),
    tags: jsonb("tags").$type<string[]>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    ownerIdx: index("ai_skill_owner_idx").on(t.ownerId, t.updatedAt),
  }),
);

export type AiSpendRow = typeof aiSpend.$inferSelect;
export type AiSpendInsert = typeof aiSpend.$inferInsert;
export type AiSkillRow = typeof aiSkill.$inferSelect;
export type AiSkillInsert = typeof aiSkill.$inferInsert;
export type AiMemoryRow = typeof aiMemory.$inferSelect;
export type AiMemoryInsert = typeof aiMemory.$inferInsert;
export type AiToolCallRow = typeof aiToolCalls.$inferSelect;
export type AiToolCallInsert = typeof aiToolCalls.$inferInsert;
export type AiConversationRow = typeof aiConversations.$inferSelect;
export type AiConversationInsert = typeof aiConversations.$inferInsert;
export type AiMessageRow = typeof aiMessages.$inferSelect;
export type AiMessageInsert = typeof aiMessages.$inferInsert;
