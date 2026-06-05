import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { AiPermissionMode } from "@checkstack/ai-common";
import * as schema from "../schema";
import type {
  AiConversationRow,
  AiMessageRow,
} from "../schema";
import { scrubContent, scrubModelMessages } from "./scrub-content";

type AiDatabase = SafeDatabase<typeof schema>;

/** A persisted chat message role (AI-SDK roles). */
export type AiMessageRole = "system" | "user" | "assistant" | "tool";

/**
 * Durable conversation + message persistence (plan §4, state-and-scale §9).
 *
 * All chat state lives in shared Postgres so any pod can list, continue, or
 * append to a conversation — the agent loop is resumable on whichever pod
 * handles the next turn. Nothing about a conversation is pod-local. Ownership is
 * enforced at the handler via the session principal (the store always filters by
 * `userId` so one user can never read another's chat).
 */
export interface AiConversationStore {
  createConversation(args: {
    userId: string;
    title?: string;
    integrationId?: string;
    model?: string;
    /** Permission mode for the conversation; defaults to `approve` when omitted. */
    permissionMode?: AiPermissionMode;
  }): Promise<AiConversationRow>;

  /** List a user's conversations, most-recently-updated first. */
  listConversations(args: { userId: string }): Promise<AiConversationRow[]>;

  /** Fetch one conversation IF it belongs to the user, else undefined. */
  getConversation(args: {
    id: string;
    userId: string;
  }): Promise<AiConversationRow | undefined>;

  /**
   * Append a message; bumps the conversation's `updatedAt`. The `content`,
   * `toolCalls`, and `modelMessages` bags are SCRUBBED of any credential-shaped
   * key/value before they hit Postgres (see `scrubContent`), so a secret can
   * never be persisted into message content — an enforced, not merely
   * architectural, invariant.
   */
  appendMessage(args: {
    conversationId: string;
    role: AiMessageRole;
    content: Record<string, unknown>;
    toolCalls?: Array<Record<string, unknown>>;
    /**
     * AI-SDK `ResponseMessage[]` for tool-call REPLAY (assistant tool-call +
     * tool-result parts). Persisted verbatim (after scrubbing) so a resumed
     * conversation replays the full prior tool interaction to the model.
     */
    modelMessages?: Array<Record<string, unknown>>;
  }): Promise<AiMessageRow>;

  /** All messages for a conversation, oldest-first (the loop's history). */
  listMessages(args: {
    conversationId: string;
  }): Promise<AiMessageRow[]>;

  /** Update mutable conversation metadata (title / model / permission mode). */
  updateConversation(args: {
    id: string;
    userId: string;
    title?: string;
    model?: string;
    permissionMode?: AiPermissionMode;
  }): Promise<AiConversationRow | undefined>;

  /**
   * SOFT-DELETE (archive) a conversation IF it belongs to the user: stamps
   * `archivedAt = now` so the row + its messages are RETAINED (later abuse
   * introspection) but the chat disappears from `listConversations`. This is the
   * user-facing "Delete" action. Returns true when an owned, not-yet-archived row
   * was stamped, false otherwise (wrong owner / already archived / missing).
   */
  archiveConversation(args: { id: string; userId: string }): Promise<boolean>;

  /**
   * HARD-delete a conversation (cascades to messages) IF it belongs to the user.
   * NOT exposed to the user-facing delete action (that archives); retained only
   * for non-user callers such as a retention sweep.
   */
  deleteConversation(args: { id: string; userId: string }): Promise<boolean>;
}

export function createAiConversationStore({
  db,
}: {
  db: AiDatabase;
}): AiConversationStore {
  return {
    async createConversation({
      userId,
      title,
      integrationId,
      model,
      permissionMode,
    }) {
      const [row] = await db
        .insert(schema.aiConversations)
        // `permissionMode` omitted -> the column default ("approve") applies.
        .values({ userId, title, integrationId, model, permissionMode })
        .returning();
      return row;
    },

    async listConversations({ userId }) {
      // Archived (soft-deleted) conversations are retained in the table but
      // excluded from the sidebar list.
      return db
        .select()
        .from(schema.aiConversations)
        .where(
          and(
            eq(schema.aiConversations.userId, userId),
            isNull(schema.aiConversations.archivedAt),
          ),
        )
        .orderBy(desc(schema.aiConversations.updatedAt));
    },

    async getConversation({ id, userId }) {
      const rows = await db
        .select()
        .from(schema.aiConversations)
        .where(
          and(
            eq(schema.aiConversations.id, id),
            eq(schema.aiConversations.userId, userId),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async appendMessage({
      conversationId,
      role,
      content,
      toolCalls,
      modelMessages,
    }) {
      // Scrub credential-shaped keys/values from EVERY bag on the write path:
      // the no-secret-leak guarantee is enforced here, not merely assumed.
      const [row] = await db
        .insert(schema.aiMessages)
        .values({
          conversationId,
          role,
          content: scrubContent(content),
          toolCalls: toolCalls ? scrubModelMessages(toolCalls) : toolCalls,
          modelMessages: modelMessages
            ? scrubModelMessages(modelMessages)
            : modelMessages,
        })
        .returning();
      // Bump the owning conversation so list order reflects activity.
      await db
        .update(schema.aiConversations)
        .set({ updatedAt: new Date() })
        .where(eq(schema.aiConversations.id, conversationId));
      return row;
    },

    async listMessages({ conversationId }) {
      return db
        .select()
        .from(schema.aiMessages)
        .where(eq(schema.aiMessages.conversationId, conversationId))
        .orderBy(asc(schema.aiMessages.createdAt));
    },

    async updateConversation({ id, userId, title, model, permissionMode }) {
      const set: Partial<{
        title: string;
        model: string;
        permissionMode: AiPermissionMode;
        updatedAt: Date;
      }> = {
        updatedAt: new Date(),
      };
      if (title !== undefined) set.title = title;
      if (model !== undefined) set.model = model;
      if (permissionMode !== undefined) set.permissionMode = permissionMode;
      const [row] = await db
        .update(schema.aiConversations)
        .set(set)
        .where(
          and(
            eq(schema.aiConversations.id, id),
            eq(schema.aiConversations.userId, userId),
          ),
        )
        .returning();
      return row;
    },

    async archiveConversation({ id, userId }) {
      // Owner-scoped soft delete: only stamp a row that is owned AND not already
      // archived, so a repeat archive is a no-op (returns false).
      const archived = await db
        .update(schema.aiConversations)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(schema.aiConversations.id, id),
            eq(schema.aiConversations.userId, userId),
            isNull(schema.aiConversations.archivedAt),
          ),
        )
        .returning({ id: schema.aiConversations.id });
      return archived.length > 0;
    },

    async deleteConversation({ id, userId }) {
      const deleted = await db
        .delete(schema.aiConversations)
        .where(
          and(
            eq(schema.aiConversations.id, id),
            eq(schema.aiConversations.userId, userId),
          ),
        )
        .returning({ id: schema.aiConversations.id });
      return deleted.length > 0;
    },
  };
}
