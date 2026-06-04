import { and, eq, lt, gt } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { AiToolEffect } from "@checkstack/ai-common";
import * as schema from "../schema";
import type { AiToolCallRow } from "../schema";
import { generateProposalNonce } from "./token";

type AiDatabase = SafeDatabase<typeof schema>;

/** Default proposal-token TTL — 10 minutes (LOCKED, §13.4). */
export const PROPOSAL_TTL_MS = 10 * 60 * 1000;

export interface AuditPrincipal {
  kind: "user" | "application";
  id: string;
}

/**
 * The durable audit log + propose/apply token store. A `proposed` row IS the
 * token (decision §4, §13.4); there is no separate ephemeral table. All state
 * is in shared Postgres, so a token proposed on one pod is consumable on any
 * other (state-and-scale).
 */
export interface AiToolCallStore {
  /** Record a directly-executed tool (read, or an automation-run mutate). */
  recordExecuted(args: {
    principal: AuditPrincipal;
    transport: "chat" | "mcp" | "automation";
    conversationId?: string;
    toolName: string;
    argsHash: string;
    resultSnapshot?: Record<string, unknown>;
  }): Promise<AiToolCallRow>;

  /** Record a failed execute (audit only). */
  recordFailed(args: {
    principal: AuditPrincipal;
    transport: "chat" | "mcp" | "automation";
    conversationId?: string;
    toolName: string;
    effect: AiToolEffect;
    argsHash: string;
    error: string;
  }): Promise<AiToolCallRow>;

  /**
   * Persist a `proposed` row (the token store). Returns the row plus the fresh
   * nonce; the caller formats `propose:<id>.<nonce>`.
   */
  createProposal(args: {
    principal: AuditPrincipal;
    transport: "chat" | "mcp";
    conversationId?: string;
    toolName: string;
    effect: AiToolEffect;
    argsHash: string;
    proposedPayload: Record<string, unknown>;
    resultSnapshot?: Record<string, unknown>;
    now?: Date;
  }): Promise<{ row: AiToolCallRow; nonce: string }>;

  /**
   * Atomically consume a `proposed` row: a single
   * `UPDATE ... WHERE id = ? AND status = 'proposed'` flips it to `applied` and
   * RETURNS the row. A second apply finds `status != 'proposed'` and gets
   * `undefined` (single-use even under concurrent calls). Returns `undefined`
   * when the row is missing, already consumed, or the conditions don't hold.
   *
   * `applier` is the principal that actually called `apply` — stamped into
   * `appliedByKind`/`appliedById` so the audit log records WHO applied, not just
   * who proposed (P3 review item 1). Usually identical to the proposer.
   */
  consumeProposal(args: {
    rowId: string;
    applier: AuditPrincipal;
    now?: Date;
  }): Promise<AiToolCallRow | undefined>;

  /** Fetch a proposal row by id without consuming it (for nonce/TTL checks). */
  getProposal(rowId: string): Promise<AiToolCallRow | undefined>;

  /**
   * Sweep: flip expired `proposed` rows to `expired`, retaining them as audit
   * history. Returns the number of rows expired.
   */
  expireStaleProposals(now?: Date): Promise<number>;
}

export function createAiToolCallStore({
  db,
}: {
  db: AiDatabase;
}): AiToolCallStore {
  return {
    async recordExecuted({
      principal,
      transport,
      conversationId,
      toolName,
      argsHash,
      resultSnapshot,
    }) {
      const [row] = await db
        .insert(schema.aiToolCalls)
        .values({
          principalKind: principal.kind,
          principalId: principal.id,
          transport,
          conversationId,
          toolName,
          effect: "read",
          argsHash,
          status: "executed",
          resultSnapshot,
        })
        .returning();
      return row;
    },

    async recordFailed({
      principal,
      transport,
      conversationId,
      toolName,
      effect,
      argsHash,
      error,
    }) {
      const [row] = await db
        .insert(schema.aiToolCalls)
        .values({
          principalKind: principal.kind,
          principalId: principal.id,
          transport,
          conversationId,
          toolName,
          effect,
          argsHash,
          status: "failed",
          error,
        })
        .returning();
      return row;
    },

    async createProposal({
      principal,
      transport,
      conversationId,
      toolName,
      effect,
      argsHash,
      proposedPayload,
      resultSnapshot,
      now = new Date(),
    }) {
      const nonce = generateProposalNonce();
      const [row] = await db
        .insert(schema.aiToolCalls)
        .values({
          principalKind: principal.kind,
          principalId: principal.id,
          transport,
          conversationId,
          toolName,
          effect,
          argsHash,
          status: "proposed",
          proposalNonce: nonce,
          proposalExpiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
          proposedPayload,
          resultSnapshot,
          proposedAt: now,
        })
        .returning();
      return { row, nonce };
    },

    async consumeProposal({ rowId, applier, now = new Date() }) {
      // Atomic single-use: only a still-`proposed`, non-expired row transitions
      // to `applied`. A concurrent second apply matches zero rows.
      const [row] = await db
        .update(schema.aiToolCalls)
        .set({
          status: "applied",
          appliedAt: now,
          appliedByKind: applier.kind,
          appliedById: applier.id,
        })
        .where(
          and(
            eq(schema.aiToolCalls.id, rowId),
            eq(schema.aiToolCalls.status, "proposed"),
            gt(schema.aiToolCalls.proposalExpiresAt, now),
          ),
        )
        .returning();
      return row;
    },

    async getProposal(rowId) {
      const rows = await db
        .select()
        .from(schema.aiToolCalls)
        .where(eq(schema.aiToolCalls.id, rowId))
        .limit(1);
      return rows[0];
    },

    async expireStaleProposals(now = new Date()) {
      const expired = await db
        .update(schema.aiToolCalls)
        .set({ status: "expired" })
        .where(
          and(
            eq(schema.aiToolCalls.status, "proposed"),
            lt(schema.aiToolCalls.proposalExpiresAt, now),
          ),
        )
        .returning({ id: schema.aiToolCalls.id });
      return expired.length;
    },
  };
}
