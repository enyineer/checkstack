/**
 * Drizzle-backed implementation of `RunStore`. The dispatch engine uses
 * this for every run / step / wait-lock write so durability survives
 * process restarts.
 *
 * Kept thin: each method maps almost 1:1 to a DB statement. Concurrency
 * and consistency concerns live in the calling code (the dispatcher and
 * trigger subscriber).
 */
import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";

import {
  automationRunSteps,
  automationRuns,
  automationWaitLocks,
} from "../schema";
import type {
  CreateRunInput,
  CreateStepInput,
  CreateWaitLockInput,
  LoadedRun,
  LoadedStep,
  LoadedWaitLock,
  RunStore,
  UntilWaitConfig,
  WaitLockKind,
} from "./types";

type Schema = {
  automationRuns: typeof automationRuns;
  automationRunSteps: typeof automationRunSteps;
  automationWaitLocks: typeof automationWaitLocks;
};

const ACTIVE_STATUSES = ["pending", "running", "waiting"] as const;

export function createRunStore(db: SafeDatabase<Schema>): RunStore {
  return {
    async createRun(input: CreateRunInput): Promise<string> {
      const [row] = await db
        .insert(automationRuns)
        .values({
          automationId: input.automationId,
          triggerId: input.triggerId,
          triggerEventId: input.triggerEventId,
          triggerPayload: input.triggerPayload,
          contextKey: input.contextKey,
          status: "running",
        })
        .returning({ id: automationRuns.id });
      if (!row) throw new Error("createRun: insert returned no rows");
      return row.id;
    },

    async updateRunStatus(runId, status, errorMessage): Promise<void> {
      const isTerminal =
        status === "success" ||
        status === "failed" ||
        status === "cancelled" ||
        status === "skipped";
      await db
        .update(automationRuns)
        .set({
          status,
          errorMessage: errorMessage ?? null,
          finishedAt: isTerminal ? new Date() : null,
        })
        .where(eq(automationRuns.id, runId));
    },

    async loadRun(runId: string): Promise<LoadedRun | undefined> {
      const rows = await db
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.id, runId))
        .limit(1);
      const row = rows[0];
      if (!row) return undefined;
      return {
        id: row.id,
        automationId: row.automationId,
        triggerId: row.triggerId,
        triggerEventId: row.triggerEventId,
        triggerPayload: row.triggerPayload,
        contextKey: row.contextKey,
        status: row.status,
        errorMessage: row.errorMessage,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
      };
    },

    async countActiveRuns(automationId: string): Promise<number> {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(automationRuns)
        .where(
          and(
            eq(automationRuns.automationId, automationId),
            inArray(automationRuns.status, [...ACTIVE_STATUSES]),
          ),
        );
      return rows[0]?.count ?? 0;
    },

    async hasActiveRun(automationId: string): Promise<boolean> {
      const rows = await db
        .select({ id: automationRuns.id })
        .from(automationRuns)
        .where(
          and(
            eq(automationRuns.automationId, automationId),
            inArray(automationRuns.status, [...ACTIVE_STATUSES]),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async cancelActiveRuns(
      automationId: string,
      reason: string,
    ): Promise<string[]> {
      const rows = await db
        .update(automationRuns)
        .set({
          status: "cancelled",
          errorMessage: reason,
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(automationRuns.automationId, automationId),
            inArray(automationRuns.status, [...ACTIVE_STATUSES]),
          ),
        )
        .returning({ id: automationRuns.id });
      return rows.map((r) => r.id);
    },

    async createStep(input: CreateStepInput): Promise<string> {
      const [row] = await db
        .insert(automationRunSteps)
        .values({
          runId: input.runId,
          actionPath: input.actionPath,
          actionId: input.actionId,
          actionKind: input.actionKind,
          providerActionId: input.providerActionId,
          status: "running",
          attempts: 1,
        })
        .returning({ id: automationRunSteps.id });
      if (!row) throw new Error("createStep: insert returned no rows");
      return row.id;
    },

    async updateStep(stepId, patch): Promise<void> {
      const isTerminal =
        patch.status === "success" ||
        patch.status === "failed" ||
        patch.status === "skipped";
      const set: Record<string, unknown> = {
        status: patch.status,
        errorMessage: patch.errorMessage ?? null,
        resultPayload: patch.resultPayload ?? null,
      };
      if (isTerminal) set.finishedAt = new Date();
      if (patch.incrementAttempts) {
        set.attempts = sql`${automationRunSteps.attempts} + 1`;
      }
      await db
        .update(automationRunSteps)
        .set(set)
        .where(eq(automationRunSteps.id, stepId));
    },

    async findStepByPath(runId, actionPath): Promise<LoadedStep | undefined> {
      const rows = await db
        .select()
        .from(automationRunSteps)
        .where(
          and(
            eq(automationRunSteps.runId, runId),
            eq(automationRunSteps.actionPath, actionPath),
          ),
        )
        .orderBy(desc(automationRunSteps.startedAt))
        .limit(1);
      const row = rows[0];
      if (!row) return;
      return {
        id: row.id,
        runId: row.runId,
        actionPath: row.actionPath,
        actionId: row.actionId,
        actionKind: row.actionKind,
        status: row.status,
        attempts: row.attempts,
        errorMessage: row.errorMessage,
        resultPayload: row.resultPayload,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
      };
    },

    async createWaitLock(input: CreateWaitLockInput): Promise<string> {
      const [row] = await db
        .insert(automationWaitLocks)
        .values({
          runId: input.runId,
          actionPath: input.actionPath,
          kind: input.kind,
          eventId: input.eventId,
          contextKey: input.contextKey,
          filterTemplate: input.filterTemplate,
          timeoutAt: input.timeoutAt,
          // Serialisation boundary: UntilWaitConfig is a plain JSON object
          // but its `condition` union isn't structurally a Record, so cast.
          waitConfig: input.waitConfig
            ? (input.waitConfig as unknown as Record<string, unknown>)
            : undefined,
        })
        .returning({ id: automationWaitLocks.id });
      if (!row) throw new Error("createWaitLock: insert returned no rows");
      return row.id;
    },

    async loadWaitLock(id) {
      const rows = await db
        .select()
        .from(automationWaitLocks)
        .where(eq(automationWaitLocks.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) return;
      return mapWaitLock(row);
    },

    async findWaitLocksFor(
      eventId: string,
      contextKey: string | null,
    ): Promise<LoadedWaitLock[]> {
      const filters = [
        eq(automationWaitLocks.eventId, eventId),
        contextKey === null
          ? isNull(automationWaitLocks.contextKey)
          : eq(automationWaitLocks.contextKey, contextKey),
      ];
      const rows = await db
        .select()
        .from(automationWaitLocks)
        .where(and(...filters));
      return rows.map((r) => mapWaitLock(r));
    },

    async findWaitLocksByKind(kind): Promise<LoadedWaitLock[]> {
      const rows = await db
        .select()
        .from(automationWaitLocks)
        .where(eq(automationWaitLocks.kind, kind));
      return rows.map((r) => mapWaitLock(r));
    },

    async deleteWaitLock(id: string): Promise<void> {
      await db.delete(automationWaitLocks).where(eq(automationWaitLocks.id, id));
    },

    async sweepExpiredWaitLocks(now: Date): Promise<LoadedWaitLock[]> {
      const rows = await db
        .select()
        .from(automationWaitLocks)
        .where(
          and(
            isNotNull(automationWaitLocks.timeoutAt),
            lte(automationWaitLocks.timeoutAt, now),
          ),
        );
      return rows.map((r) => mapWaitLock(r));
    },
  };
}

/** Map a wait-lock row to the engine's {@link LoadedWaitLock}. */
function mapWaitLock(
  row: typeof automationWaitLocks.$inferSelect,
): LoadedWaitLock {
  return {
    id: row.id,
    runId: row.runId,
    actionPath: row.actionPath,
    kind: row.kind as WaitLockKind,
    eventId: row.eventId,
    contextKey: row.contextKey,
    filterTemplate: row.filterTemplate,
    timeoutAt: row.timeoutAt,
    waitConfig: (row.waitConfig as UntilWaitConfig | null) ?? null,
    createdAt: row.createdAt,
  };
}
