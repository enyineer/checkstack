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
import { and, eq, lt } from "drizzle-orm";
import type {
  AdvisoryLockHandle,
  AdvisoryLockService,
  SafeDatabase,
} from "@checkstack/backend-api";

import { automationRunState, automationRuns } from "../schema";
import type { RunSecretRegistry } from "./run-secret-registry";

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
   *
   * Omitting `lastActionPath` (vs. passing `null`) on an UPDATE preserves
   * the existing checkpoint. This matters at suspend-finalisation: the
   * checkpoint written by the suspending action (its real path) must
   * survive so a crash-recovery resumes from it rather than re-walking
   * from `actions[0]`. Passing `null` explicitly still clobbers it (used
   * only for the initial pre-first-step snapshot).
   */
  upsert(input: {
    runId: string;
    scopeSnapshot: Record<string, unknown>;
    lastActionPath?: string | null;
  }): Promise<void>;

  load(runId: string): Promise<RunStateSnapshot | undefined>;

  /** Drop the state row — done at terminal run status. */
  clear(runId: string): Promise<void>;

  /** Bump only the heartbeat. Used by long-running container handlers. */
  heartbeat(runId: string): Promise<void>;

  /**
   * Run ids of `status = 'running'` runs whose heartbeat is older than
   * `threshold`. Returned in heartbeat-ascending order so the sweeper
   * processes the most stale first.
   *
   * The status filter is load-bearing: `waiting` runs (suspended on a
   * `delay` / `wait_for_trigger` / `wait_until`) keep their state row but
   * are NOT stalled - they are owned by the wait-lock / queue resume
   * paths. Returning them here would let the sweeper re-walk an
   * intentional wait every cycle, re-firing pre-wait side effects and
   * leaking wait locks. Only a `running` run whose heartbeat went cold is
   * a genuine crash.
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

type Schema = {
  automationRunState: typeof automationRunState;
  automationRuns: typeof automationRuns;
};

/** Namespace run locks in the global advisory-lock space. */
function runLockKey(runId: string): string {
  return `automation.run:${runId}`;
}

export function createRunStateStore(
  db: SafeDatabase<Schema>,
  advisoryLock: AdvisoryLockService,
  /**
   * Run-scoped secret values accumulated during dispatch. When provided,
   * the persisted `scopeSnapshot` is masked (Jenkins-style, by-value)
   * BEFORE write — so a resolved connection credential threaded into
   * `scope.variables` / `scope.artifacts` can't reach a replay reader
   * (`getRunScopeForReplay`) unmasked. The registry is in-memory and gone
   * by replay time, so persist-time is the only place masking can happen.
   * Optional so tests / older boots degrade to no masking.
   */
  secretRegistry?: RunSecretRegistry,
): RunStateStore {
  return {
    async upsert(input) {
      // Mask the scope snapshot at the persistence choke point — same
      // pattern the run store uses for step / run output.
      const maskedScope = (secretRegistry?.maskDeep(
        input.runId,
        input.scopeSnapshot,
      ) ?? input.scopeSnapshot) as Record<string, unknown>;
      // Omitting `lastActionPath` preserves the existing checkpoint on an
      // UPDATE (so a suspend-finalisation doesn't clobber the suspending
      // action's path to null). The INSERT still needs a value, so a fresh
      // row defaults to null.
      const updateSet: Record<string, unknown> = {
        scopeSnapshot: maskedScope,
        lastHeartbeatAt: new Date(),
        updatedAt: new Date(),
      };
      if (input.lastActionPath !== undefined) {
        updateSet.lastActionPath = input.lastActionPath;
      }
      await db
        .insert(automationRunState)
        .values({
          runId: input.runId,
          scopeSnapshot: maskedScope,
          lastActionPath: input.lastActionPath ?? null,
        })
        .onConflictDoUpdate({
          target: automationRunState.runId,
          set: updateSet,
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
      // Join the run row so we only return runs that are actually
      // `running`. A `waiting` run keeps its state snapshot but must NOT
      // be re-walked by the sweeper - it is owned by the wait-lock /
      // queue resume paths.
      const rows = await db
        .select({ runId: automationRunState.runId })
        .from(automationRunState)
        .innerJoin(
          automationRuns,
          eq(automationRuns.id, automationRunState.runId),
        )
        .where(
          and(
            lt(automationRunState.lastHeartbeatAt, threshold),
            eq(automationRuns.status, "running"),
          ),
        )
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
