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
import type { Logger, SafeDatabase } from "@checkstack/backend-api";

import {
  automationRunState,
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
  WaitLockKind,
} from "./types";
import { parseWaitConfig } from "./snapshots";
import type { RunSecretRegistry } from "./run-secret-registry";

type Schema = {
  automationRuns: typeof automationRuns;
  automationRunSteps: typeof automationRunSteps;
  automationWaitLocks: typeof automationWaitLocks;
  automationRunState: typeof automationRunState;
};

const ACTIVE_STATUSES = ["pending", "running", "waiting"] as const;

/**
 * Predicate for "active runs of this automation". When `contextKey` is
 * `undefined` the filter is per-automation (the default concurrency
 * scope); when provided (string or `null`) it additionally narrows to
 * that context key (the per-context-key scope) - `null` matches runs
 * with no context key.
 */
function activeRunsPredicate(
  automationId: string,
  contextKey: string | null | undefined,
) {
  const conditions = [
    eq(automationRuns.automationId, automationId),
    inArray(automationRuns.status, [...ACTIVE_STATUSES]),
  ];
  if (contextKey !== undefined) {
    conditions.push(
      contextKey === null
        ? isNull(automationRuns.contextKey)
        : eq(automationRuns.contextKey, contextKey),
    );
  }
  return and(...conditions);
}

export function createRunStore(
  db: SafeDatabase<Schema>,
  logger?: Logger,
  /**
   * Run-scoped secret values accumulated during dispatch. When provided,
   * step `resultPayload` / `errorMessage` and run-level `errorMessage` are
   * masked (Jenkins-style, by-value) BEFORE persistence, so no resolved
   * secret can reach a DTO / run-detail page. Optional so tests / older
   * boots degrade to no masking.
   */
  secretRegistry?: RunSecretRegistry,
): RunStore {
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
      // Mask the run-level error before persisting (a provider HTTP error
      // could embed a resolved credential).
      const maskedError =
        errorMessage === undefined
          ? null
          : (secretRegistry?.maskText(runId, errorMessage) ?? errorMessage);
      await db
        .update(automationRuns)
        .set({
          status,
          errorMessage: maskedError,
          finishedAt: isTerminal ? new Date() : null,
        })
        .where(eq(automationRuns.id, runId));
      // Drop the run's accumulated mask set once it is terminal (memory-only).
      if (isTerminal) secretRegistry?.drop(runId);
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

    async countActiveRuns(
      automationId: string,
      contextKey?: string | null,
    ): Promise<number> {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(automationRuns)
        .where(activeRunsPredicate(automationId, contextKey));
      return rows[0]?.count ?? 0;
    },

    async hasActiveRun(
      automationId: string,
      contextKey?: string | null,
    ): Promise<boolean> {
      const rows = await db
        .select({ id: automationRuns.id })
        .from(automationRuns)
        .where(activeRunsPredicate(automationId, contextKey))
        .limit(1);
      return rows.length > 0;
    },

    async cancelActiveRuns(
      automationId: string,
      reason: string,
      contextKey?: string | null,
    ): Promise<string[]> {
      const rows = await db
        .update(automationRuns)
        .set({
          status: "cancelled",
          errorMessage: reason,
          finishedAt: new Date(),
        })
        .where(activeRunsPredicate(automationId, contextKey))
        .returning({ id: automationRuns.id });
      const ids = rows.map((r) => r.id);
      // Tear down the cancelled runs' suspension state in the SAME
      // operation: delete their wait locks and durable run-state so a
      // later wake (wakeWaitingRuns / delay-expiry / a racing queue job)
      // can't resurrect a cancelled run. Mirrors the operator cancelRun
      // path. (resumeRun also guards on status, but cleaning up here stops
      // the sweeper from even re-ticking an orphaned lock.)
      if (ids.length > 0) {
        await db
          .delete(automationWaitLocks)
          .where(inArray(automationWaitLocks.runId, ids));
        await db
          .delete(automationRunState)
          .where(inArray(automationRunState.runId, ids));
        // Drop each run's in-memory mask set (terminal).
        for (const id of ids) secretRegistry?.drop(id);
      }
      return ids;
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
      // Link the step to its run so updateStep (which carries only stepId)
      // can find the run's mask set.
      secretRegistry?.linkStep(row.id, input.runId);
      return row.id;
    },

    async updateStep(stepId, patch): Promise<void> {
      const isTerminal =
        patch.status === "success" ||
        patch.status === "failed" ||
        patch.status === "skipped";
      // Mask resolved secret values out of the step output BEFORE persist —
      // this is the run-wide choke point covering ALL actions (provider,
      // log, etc.), not just the script/collector source-side masking.
      const maskedError =
        patch.errorMessage === undefined
          ? null
          : (secretRegistry?.maskTextForStep(stepId, patch.errorMessage) ??
            patch.errorMessage);
      const maskedPayload =
        patch.resultPayload === undefined
          ? null
          : (secretRegistry?.maskDeepForStep(stepId, patch.resultPayload) ??
            patch.resultPayload);
      const set: Record<string, unknown> = {
        status: patch.status,
        errorMessage: maskedError,
        resultPayload: maskedPayload,
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
      return mapWaitLock(row, logger);
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
      return rows.map((r) => mapWaitLock(r, logger));
    },

    async findWaitLocksByKind(kind): Promise<LoadedWaitLock[]> {
      const rows = await db
        .select()
        .from(automationWaitLocks)
        .where(eq(automationWaitLocks.kind, kind));
      return rows.map((r) => mapWaitLock(r, logger));
    },

    async findWaitLocksByRun(runId): Promise<LoadedWaitLock[]> {
      const rows = await db
        .select()
        .from(automationWaitLocks)
        .where(eq(automationWaitLocks.runId, runId));
      return rows.map((r) => mapWaitLock(r, logger));
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
      return rows.map((r) => mapWaitLock(r, logger));
    },
  };
}

/** Map a wait-lock row to the engine's {@link LoadedWaitLock}. */
function mapWaitLock(
  row: typeof automationWaitLocks.$inferSelect,
  logger?: Logger,
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
    // Parse the stored config on load — a drifted/hand-edited row degrades
    // to null (engine treats the `until` lock as gone) instead of being
    // trusted as a wrongly-typed UntilWaitConfig.
    waitConfig: parseWaitConfig({
      value: row.waitConfig,
      logger,
      context: `Wait lock ${row.id}`,
    }),
    createdAt: row.createdAt,
  };
}
