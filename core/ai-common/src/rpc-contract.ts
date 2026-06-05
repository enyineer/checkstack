import { z } from "zod";
import { createClientDefinition, proc } from "@checkstack/common";
import { aiAccess } from "./access";
import { AiPermissionModeSchema } from "./permission";
import { pluginMetadata } from "./plugin-metadata";
import { AiToolDescriptorSchema } from "./tool";

/**
 * AI platform RPC contract.
 *
 * Phase 1 exposes a single read-only introspection endpoint: `listTools`
 * returns the resolver output for the calling principal (the tools they are
 * allowed to see). Mutating tool flows (propose / apply), conversations, and
 * MCP-client management land in later phases and are intentionally absent here.
 *
 * `listTools` is gated by `ai.tools-manage`. The returned descriptors carry
 * only JSON Schema — never an executor or any `x-secret` value.
 */
/**
 * A proposal returned by `proposeTool`. The `token` is the opaque
 * `propose:<rowId>.<nonce>` consumed by `applyTool` (single-use, 10-min TTL).
 * The `payload` is the validated, ready-to-apply draft (e.g. an automation
 * definition) the confirm card / editor renders. No secret ever appears here.
 */
export const AiProposalSchema = z.object({
  token: z.string(),
  summary: z.string(),
  payload: z.unknown(),
  toolCallId: z.string(),
  expiresAt: z.coerce.date(),
});
export type AiProposal = z.infer<typeof AiProposalSchema>;

/**
 * A selectable AI integration for the chat picker (Phase 4, §14.6). Carries
 * only non-secret model UX metadata — NEVER the apiKey.
 */
export const AiChatIntegrationSchema = z.object({
  /** Qualified connection id. */
  connectionId: z.string(),
  name: z.string(),
  /** The connection's default model id (the picker defaults to this). */
  defaultModel: z.string(),
  /** Optional allowlist constraining the model picker. */
  availableModels: z.array(z.string()).optional(),
});
export type AiChatIntegration = z.infer<typeof AiChatIntegrationSchema>;

/** A chat conversation summary (Phase 4). Never carries a secret. */
export const AiConversationSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  integrationId: z.string().nullable(),
  model: z.string().nullable(),
  /**
   * Per-conversation permission mode (Phase 4). Governs the `mutate` tool branch
   * only: `auto` auto-applies mutate proposals server-side; `approve` surfaces a
   * confirm card. Reads always run; destructive always requires human apply.
   */
  permissionMode: AiPermissionModeSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AiConversation = z.infer<typeof AiConversationSchema>;

/** A persisted chat message (Phase 4). */
export const AiMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.record(z.string(), z.unknown()),
  toolCalls: z.array(z.record(z.string(), z.unknown())).nullable(),
  createdAt: z.coerce.date(),
});
export type AiMessage = z.infer<typeof AiMessageSchema>;

export const aiContract = {
  listTools: proc({
    operationType: "query",
    userType: "authenticated",
    access: [aiAccess.toolsManage],
  }).output(z.object({ tools: z.array(AiToolDescriptorSchema) })),

  /**
   * Step 1 of the two-step mutating-tool flow: run the tool's dry-run and
   * return a proposal token. NEVER mutates. Per-tool authorization is enforced
   * by the propose/apply service against the tool's `requiredAccessRules`.
   */
  proposeTool: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [aiAccess.chatUse],
  })
    .input(
      z.object({
        toolName: z.string(),
        input: z.unknown(),
      }),
    )
    .output(AiProposalSchema),

  /**
   * Step 2: consume a proposal token and commit. Single-use and atomic — a
   * second apply, an expired token, or a tampered nonce is rejected.
   */
  applyTool: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [aiAccess.chatUse],
  })
    .input(z.object({ token: z.string() }))
    .output(z.object({ toolCallId: z.string(), result: z.unknown() })),

  // ─── Phase 4: chat conversation management ──────────────────────────────
  // The streaming turn itself is a raw HTTP handler at /api/ai/chat (SSE);
  // these RPCs manage the durable conversation list/transcript (shared Postgres
  // — continuable from any pod). All are owner-scoped server-side.

  /**
   * List the AI integrations a chat user may select (§14.6). Gated by
   * `ai.chat.read` (NOT integration-manage), and returns only non-secret model
   * UX metadata so a chat-only user can pick a provider + model.
   */
  listChatIntegrations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [aiAccess.chatUse],
  }).output(z.object({ integrations: z.array(AiChatIntegrationSchema) })),

  listConversations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [aiAccess.chatUse],
  }).output(z.object({ conversations: z.array(AiConversationSchema) })),

  createConversation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [aiAccess.chatUse],
  })
    .input(
      z.object({
        title: z.string().max(200).optional(),
        integrationId: z.string().optional(),
        model: z.string().optional(),
        permissionMode: AiPermissionModeSchema.optional(),
      }),
    )
    .output(AiConversationSchema),

  getConversation: proc({
    operationType: "query",
    userType: "authenticated",
    access: [aiAccess.chatUse],
  })
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        conversation: AiConversationSchema,
        messages: z.array(AiMessageSchema),
      }),
    ),

  updateConversation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [aiAccess.chatUse],
  })
    .input(
      z.object({
        id: z.string(),
        title: z.string().max(200).optional(),
        model: z.string().optional(),
        permissionMode: AiPermissionModeSchema.optional(),
      }),
    )
    .output(AiConversationSchema),

  /**
   * SOFT-DELETE a conversation: the user-facing "Delete" action ARCHIVES the
   * chat (stamps `archivedAt`) so the row + transcript are retained for later
   * abuse introspection while disappearing from the sidebar. Owner-scoped
   * server-side, gated identically to the other conversation mutations.
   */
  archiveConversation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [aiAccess.chatUse],
  })
    .input(z.object({ id: z.string() }))
    .output(z.object({ archived: z.boolean() })),

  deleteConversation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [aiAccess.chatUse],
  })
    .input(z.object({ id: z.string() }))
    .output(z.object({ deleted: z.boolean() })),
};

export type AiContract = typeof aiContract;

/**
 * Client definition for typed cross-plugin / frontend access to the AI
 * contract.
 */
export const aiClientDefinition = createClientDefinition(
  aiContract,
  pluginMetadata,
);

/** Conventional `*Api` alias for frontend `usePluginClient(AiApi)` usage. */
export const AiApi = aiClientDefinition;
