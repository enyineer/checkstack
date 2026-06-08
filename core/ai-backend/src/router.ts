import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import { aiContract } from "@checkstack/ai-common";
import type { AiToolResolver } from "./resolver";
import { serializeTools } from "./serializer";
import {
  ProposeApplyError,
  type ProposeApplyService,
  type ProposeApplyErrorCode,
} from "./propose-apply/service";
import {
  createUserScopedRpcClient,
  forwardableAuthHeadersFrom,
} from "./user-rpc-client";

import type { AiConversationStore } from "./chat/conversation-store";
import type { AiMemoryStore } from "./memory-store";
import type { AiSkillStore } from "./skill-store";
import type { AiSkillResolver } from "./skill-resolver";
import type { SystemAccessResolver } from "./system-signals-contributor";
import { accessibleSystems } from "./tools/memory-tools";
import type {
  AiConversationRow,
  AiMemoryRow,
  AiMessageRow,
} from "./schema";

/** A selectable AI integration's non-secret model UX metadata. */
export interface ChatIntegrationInfo {
  connectionId: string;
  name: string;
  defaultModel: string;
  availableModels?: string[];
}

/** Lists selectable AI integrations (non-secret model UX metadata) for chat. */
export interface ChatIntegrationLister {
  list(): Promise<ChatIntegrationInfo[]>;
}

/**
 * Coerce a caller-supplied model id against an integration's `availableModels`
 * allowlist (untrusted wire input). Returns the requested model when allowed,
 * otherwise the connection's `defaultModel`. Returns `undefined` only when the
 * integration cannot be resolved (no model can be validated). Uses only the
 * non-secret model metadata, never the credential.
 */
export async function coerceConversationModel({
  integrations,
  integrationId,
  model,
}: {
  integrations: ChatIntegrationLister;
  integrationId: string | undefined;
  model: string | undefined;
}): Promise<string | undefined> {
  if (model === undefined) return undefined;
  if (!integrationId) {
    // No integration to validate against: drop the unvalidated model id rather
    // than persist an arbitrary one.
    return undefined;
  }
  const list = await integrations.list();
  const info = list.find((i) => i.connectionId === integrationId);
  if (!info) return undefined;
  const allow = info.availableModels;
  if (allow && allow.length > 0 && !allow.includes(model)) {
    return info.defaultModel;
  }
  return model;
}

interface AiRouterDeps {
  resolver: AiToolResolver;
  proposeApply: ProposeApplyService;
  conversations: AiConversationStore;
  memoryStore: AiMemoryStore;
  /** Trusted-client-backed resolver for `system`-scoped memory access gating. */
  systemAccessResolver: SystemAccessResolver;
  /** User-skill persistence (create/update/delete). */
  skillStore: AiSkillStore;
  /** Merged builtin + user skill catalogue (for listSkills). */
  skillResolver: AiSkillResolver;
  integrations: ChatIntegrationLister;
  /** Loopback base URL for the user-scoped RPC client (re-enters `/api`). */
  internalUrl: string;
}

/** Serialize a memory row for the wire (content is already scrubbed on write). */
function toMemoryDto(row: AiMemoryRow) {
  return {
    id: row.id,
    scope: row.scope,
    systemId: row.systemId,
    recallHint: row.recallHint,
    content: row.content,
    tags: row.tags ?? [],
    alwaysInject: row.alwaysInject,
    savedAt: row.updatedAt,
  };
}

/** Serialize a conversation row for the wire (no secret fields exist on it). */
function toConversationDto(row: AiConversationRow) {
  return {
    id: row.id,
    title: row.title,
    integrationId: row.integrationId,
    model: row.model,
    permissionMode: row.permissionMode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMessageDto(row: AiMessageRow) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    toolCalls: row.toolCalls ?? null,
    createdAt: row.createdAt,
  };
}

/** Map a propose/apply error to the closest oRPC error code. */
function toOrpcError(error: ProposeApplyError): ORPCError<string, unknown> {
  const mapping: Record<ProposeApplyErrorCode, string> = {
    forbidden: "FORBIDDEN",
    not_found: "NOT_FOUND",
    not_proposable: "BAD_REQUEST",
    invalid_token: "BAD_REQUEST",
    expired: "CONFLICT", // 409 — token no longer valid (TTL elapsed)
    consumed: "CONFLICT", // 409 — single-use violated
    execute_failed: "BAD_REQUEST",
  };
  return new ORPCError(mapping[error.code], { message: error.message });
}

/**
 * AI router (Phase 1 read-only introspection + Phase 3 propose/apply).
 *
 * `autoAuthMiddleware` enforces the contract's access gates, so the router is
 * the single enforcement point even though the resolver / propose-apply service
 * also re-check per-tool authorization. The model is treated as an untrusted
 * caller throughout.
 */
export function createAiRouter({
  resolver,
  proposeApply,
  conversations,
  memoryStore,
  systemAccessResolver,
  skillStore,
  skillResolver,
  integrations,
  internalUrl,
}: AiRouterDeps) {
  const os = implement(aiContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    listTools: os.listTools.handler(async ({ context }) => {
      const principal = context.user;
      if (!principal) {
        return { tools: [] };
      }
      const tools = resolver.resolveTools(principal);
      return { tools: serializeTools({ tools }) };
    }),

    proposeTool: os.proposeTool.handler(async ({ context, input }) => {
      const principal = context.user;
      if (!principal) {
        throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
      }
      // USER-SCOPED RPC client: the tool's dry-run re-enters `/api` as THIS
      // user (forwarding the request's own cookie/bearer), so handler authz +
      // per-resource/team scope apply - never the trusted service client.
      const rpcClient = createUserScopedRpcClient({
        internalUrl,
        forwardHeaders: forwardableAuthHeadersFrom(context.requestHeaders),
      });
      try {
        const proposal = await proposeApply.propose({
          principal,
          toolName: input.toolName,
          input: input.input,
          transport: "chat",
          rpcClient,
        });
        return {
          token: proposal.token,
          summary: proposal.summary,
          payload: proposal.payload,
          toolCallId: proposal.toolCallId,
          expiresAt: proposal.expiresAt,
        };
      } catch (error) {
        if (error instanceof ProposeApplyError) throw toOrpcError(error);
        throw error;
      }
    }),

    applyTool: os.applyTool.handler(async ({ context, input }) => {
      const principal = context.user;
      if (!principal) {
        throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
      }
      // USER-SCOPED RPC client (see proposeTool): the tool's commit runs as
      // THIS user, so handler authz + per-resource/team scope apply at apply
      // time exactly as a direct UI/RPC call would.
      const rpcClient = createUserScopedRpcClient({
        internalUrl,
        forwardHeaders: forwardableAuthHeadersFrom(context.requestHeaders),
      });
      try {
        const applied = await proposeApply.apply({
          principal,
          token: input.token,
          transport: "chat",
          rpcClient,
        });
        return { toolCallId: applied.toolCallId, result: applied.result };
      } catch (error) {
        if (error instanceof ProposeApplyError) throw toOrpcError(error);
        throw error;
      }
    }),

    listChatIntegrations: os.listChatIntegrations.handler(
      async ({ context }) => {
        const principal = context.user;
        if (!principal) {
          throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
        }
        const integrationList = await integrations.list();
        return { integrations: integrationList };
      },
    ),

    listConversations: os.listConversations.handler(async ({ context }) => {
      const principal = context.user;
      if (!principal || principal.type !== "user") {
        throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
      }
      const rows = await conversations.listConversations({
        userId: principal.id,
      });
      return { conversations: rows.map((r) => toConversationDto(r)) };
    }),

    createConversation: os.createConversation.handler(
      async ({ context, input }) => {
        const principal = context.user;
        if (!principal || principal.type !== "user") {
          throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
        }
        // The model id is untrusted wire input — coerce it against the chosen
        // integration's allowlist before persisting (defeats model/cost-control
        // bypass via a hand-crafted create call).
        const model = await coerceConversationModel({
          integrations,
          integrationId: input.integrationId,
          model: input.model,
        });
        const row = await conversations.createConversation({
          userId: principal.id,
          title: input.title,
          integrationId: input.integrationId,
          model,
          permissionMode: input.permissionMode,
        });
        return toConversationDto(row);
      },
    ),

    getConversation: os.getConversation.handler(async ({ context, input }) => {
      const principal = context.user;
      if (!principal || principal.type !== "user") {
        throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
      }
      const conversation = await conversations.getConversation({
        id: input.id,
        userId: principal.id,
      });
      if (!conversation) {
        throw new ORPCError("NOT_FOUND", { message: "Conversation not found" });
      }
      const messages = await conversations.listMessages({
        conversationId: input.id,
      });
      return {
        conversation: toConversationDto(conversation),
        messages: messages.map((m) => toMessageDto(m)),
      };
    }),

    updateConversation: os.updateConversation.handler(
      async ({ context, input }) => {
        const principal = context.user;
        if (!principal || principal.type !== "user") {
          throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
        }
        // Coerce the (untrusted) model id against the conversation's integration
        // allowlist. Fetch the owned conversation first to read its integration
        // id (also enforces ownership before any write).
        let model = input.model;
        if (model !== undefined) {
          const existing = await conversations.getConversation({
            id: input.id,
            userId: principal.id,
          });
          if (!existing) {
            throw new ORPCError("NOT_FOUND", {
              message: "Conversation not found",
            });
          }
          model = await coerceConversationModel({
            integrations,
            integrationId: existing.integrationId ?? undefined,
            model,
          });
        }
        const row = await conversations.updateConversation({
          id: input.id,
          userId: principal.id,
          title: input.title,
          model,
          permissionMode: input.permissionMode,
        });
        if (!row) {
          throw new ORPCError("NOT_FOUND", {
            message: "Conversation not found",
          });
        }
        return toConversationDto(row);
      },
    ),

    archiveConversation: os.archiveConversation.handler(
      async ({ context, input }) => {
        const principal = context.user;
        if (!principal || principal.type !== "user") {
          throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
        }
        const archived = await conversations.archiveConversation({
          id: input.id,
          userId: principal.id,
        });
        return { archived };
      },
    ),

    deleteConversation: os.deleteConversation.handler(
      async ({ context, input }) => {
        const principal = context.user;
        if (!principal || principal.type !== "user") {
          throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
        }
        const deleted = await conversations.deleteConversation({
          id: input.id,
          userId: principal.id,
        });
        return { deleted };
      },
    ),

    listMemories: os.listMemories.handler(async ({ context, input }) => {
      const principal = context.user;
      if (!principal || principal.type !== "user") {
        throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
      }
      // Systems with memories the caller may read (team grants applied centrally).
      const readable = await accessibleSystems({
        principal,
        resolver: systemAccessResolver,
        candidateSystemIds: await memoryStore.systemIdsWithMemories(),
        action: "read",
      });
      const rows = await memoryStore.list({
        ownerId: principal.id,
        readableSystemIds: [...readable],
      });
      // The system-detail card narrows to one system's `system`-scoped memories.
      const filtered = input?.systemId
        ? rows.filter(
            (r) => r.scope === "system" && r.systemId === input.systemId,
          )
        : rows;
      return { memories: filtered.map((row) => toMemoryDto(row)) };
    }),

    deleteMemory: os.deleteMemory.handler(async ({ context, input }) => {
      const principal = context.user;
      if (!principal || principal.type !== "user") {
        throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
      }
      const row = await memoryStore.findById(input.id);
      const manageable = await accessibleSystems({
        principal,
        resolver: systemAccessResolver,
        candidateSystemIds: row?.systemId ? [row.systemId] : [],
        action: "manage",
      });
      const deleted = await memoryStore.delete({
        id: input.id,
        ownerId: principal.id,
        manageableSystemIds: [...manageable],
      });
      return { deleted };
    }),

    setMemoryAlwaysInject: os.setMemoryAlwaysInject.handler(
      async ({ context, input }) => {
        const principal = context.user;
        if (!principal || principal.type !== "user") {
          throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
        }
        const row = await memoryStore.findById(input.id);
        const manageable = await accessibleSystems({
          principal,
          resolver: systemAccessResolver,
          candidateSystemIds: row?.systemId ? [row.systemId] : [],
          action: "manage",
        });
        const updated = await memoryStore.setAlwaysInject({
          id: input.id,
          ownerId: principal.id,
          manageableSystemIds: [...manageable],
          alwaysInject: input.alwaysInject,
        });
        return { updated };
      },
    ),

    // ─── Skills (reusable prompt templates) ───────────────────────────────

    listSkills: os.listSkills.handler(async ({ input }) => {
      // Skills are GLOBAL: everyone who can read skills sees the same catalogue
      // (no per-viewer scoping). Filtered to a target surface when requested.
      const skills = await skillResolver.list(input?.target);
      return { skills };
    }),

    createSkill: os.createSkill.handler(async ({ context, input }) => {
      const principal = context.user;
      if (!principal || principal.type !== "user") {
        throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
      }
      return skillStore.create({ ...input, ownerId: principal.id });
    }),

    updateSkill: os.updateSkill.handler(async ({ context, input }) => {
      const principal = context.user;
      if (!principal || principal.type !== "user") {
        throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
      }
      // Author may edit their own skill; a wildcard-holding admin may moderate
      // any. Builtins are not in the store, so they can never be edited.
      const allowAnyOwner = principal.accessRules?.includes("*") ?? false;
      const updated = await skillStore.update({
        ...input,
        ownerId: principal.id,
        allowAnyOwner,
      });
      if (!updated) {
        throw new ORPCError("NOT_FOUND", {
          message:
            "Skill not found, or you are not its author (builtin skills cannot be edited).",
        });
      }
      return updated;
    }),

    deleteSkill: os.deleteSkill.handler(async ({ context, input }) => {
      const principal = context.user;
      if (!principal || principal.type !== "user") {
        throw new ORPCError("UNAUTHORIZED", { message: "Not authenticated" });
      }
      const allowAnyOwner = principal.accessRules?.includes("*") ?? false;
      const deleted = await skillStore.delete({
        id: input.id,
        ownerId: principal.id,
        allowAnyOwner,
      });
      return { deleted };
    }),
  });
}
