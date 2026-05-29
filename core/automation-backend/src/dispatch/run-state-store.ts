/**
 * Drizzle-backed durable scope + heartbeat persistence and Postgres
 * advisory-lock helpers for the dispatch engine.
 *
 * Scope snapshots are written after every successful step so a future
 * process can resume the run exactly where the prior process left off.
 * Heartbeats let the stalled-run sweeper distinguish healthy in-flight
 * runs from runs whose host crashed mid-execution.
 *
 * Advisory locks ensure at most one instance is executing a given run
 * at a time. The lock auto-releases when the holding connection dies —
 * exactly what we want during crash recovery.
 */
import { lt, eq, sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";

import { automationRunState } from "../schema";

export interface RunStateSnapshot {
  scopeSnapshot: Record<string, unknown>;
  lastActionPath: string | null;
  lastHeartbeatAt: Date;
}

export interface RunStateStore {
  /**
   * Write or update the per-run durable state. `lastActionPath` is the
   * path of the most recently completed action — resume walks the tree
   * looking for this path and treats the action at it as already done.
   */
  upsert(input: {
    runId: string;
    scopeSnapshot: Record<string, unknown>;
    lastActionPath: string | null;
  }): Promise<void>;

  load(runId: string): Promise<RunStateSnapshot | undefined>;

  /** Drop the state row — done at terminal run status. */
  clear(runId: string): Promise<void>;

  /** Bump only the heartbeat. Used by long-running container handlers. */
  heartbeat(runId: string): Promise<void>;

  /**
   * Run ids whose heartbeat is older than `threshold`. Returned in
   * heartbeat-ascending order so the sweeper processes the most
   * stale first.
   */
  findStalledRunIds(threshold: Date): Promise<string[]>;

  /**
   * Try to acquire a Postgres session-level advisory lock for the run.
   * Returns true on acquisition. The lock auto-releases when the holding
   * DB session closes (e.g. on process crash), so dead instances don't
   * leak locks.
   */
  tryAdvisoryLock(runId: string): Promise<boolean>;

  /** Release a previously-acquired advisory lock. */
  releaseAdvisoryLock(runId: string): Promise<void>;
}

type Schema = { automationRunState: typeof automationRunState };

export function createRunStateStore(
  db: SafeDatabase<Schema>,
): RunStateStore {
  return {
    async upsert(input) {
      await db
        .insert(automationRunState)
        .values({
          runId: input.runId,
          scopeSnapshot: input.scopeSnapshot,
          lastActionPath: input.lastActionPath,
        })
        .onConflictDoUpdate({
          target: automationRunState.runId,
          set: {
            scopeSnapshot: input.scopeSnapshot,
            lastActionPath: input.lastActionPath,
            lastHeartbeatAt: new Date(),
            updatedAt: new Date(),
          },
        });
    },

    async load(runId) {
      const rows = await db
        .select()
        .from(automationRunState)
        .where(eq(automationRunState.runId, runId))
        .limit(1);
      const row = rows[0];
      if (!row) return;
      return {
        scopeSnapshot: row.scopeSnapshot,
        lastActionPath: row.lastActionPath,
        lastHeartbeatAt: row.lastHeartbeatAt,
      };
    },

    async clear(runId) {
      await db
        .delete(automationRunState)
        .where(eq(automationRunState.runId, runId));
    },

    async heartbeat(runId) {
      await db
        .update(automationRunState)
        .set({ lastHeartbeatAt: new Date() })
        .where(eq(automationRunState.runId, runId));
    },

    async findStalledRunIds(threshold) {
      const rows = await db
        .select({ runId: automationRunState.runId })
        .from(automationRunState)
        .where(lt(automationRunState.lastHeartbeatAt, threshold))
        .orderBy(automationRunState.lastHeartbeatAt);
      return rows.map((r) => r.runId);
    },

    async tryAdvisoryLock(runId) {
      // hashtextextended returns int8 in Postgres, which pg_try_advisory_lock
      // accepts directly. Using a deterministic hash means the same runId
      // always maps to the same lock key across processes.
      const result = await db.execute<{ ok: boolean }>(sql`
        SELECT pg_try_advisory_lock(hashtextextended(${runId}, 0)) AS ok
      `);
      const rows = result as unknown as { rows: Array<{ ok: boolean }> };
      return Boolean(rows.rows?.[0]?.ok);
    },

    async releaseAdvisoryLock(runId) {
      await db.execute(sql`
        SELECT pg_advisory_unlock(hashtextextended(${runId}, 0))
      `);
    },
  };
}
