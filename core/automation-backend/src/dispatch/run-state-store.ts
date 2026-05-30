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
import { lt, eq } from "drizzle-orm";
import type {
  AdvisoryLockHandle,
  AdvisoryLockService,
  SafeDatabase,
} from "@checkstack/backend-api";

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
   * Try to acquire a Postgres session-level advisory lock for the run on a
   * dedicated pooled client. Returns a handle on acquisition (release it in
   * a `finally`), or `null` if another instance already holds it.
   *
   * A dedicated client is required because the lock is held across the whole
   * resume (which executes the run's actions — potentially long and
   * involving external calls), so a transaction-scoped lock would mean a
   * minutes-long open transaction. The session lock auto-releases when the
   * holding connection dies (e.g. on process crash), so dead instances don't
   * leak locks.
   */
  tryAdvisoryLock(runId: string): Promise<AdvisoryLockHandle | null>;
}

type Schema = { automationRunState: typeof automationRunState };

/** Namespace run locks in the global advisory-lock space. */
function runLockKey(runId: string): string {
  return `automation.run:${runId}`;
}

export function createRunStateStore(
  db: SafeDatabase<Schema>,
  advisoryLock: AdvisoryLockService,
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
      // Acquire on a dedicated client (see interface doc) — the lock is held
      // for the whole resume, so it must not ride a long-open transaction.
      return advisoryLock.tryAcquire(runLockKey(runId));
    },
  };
}
