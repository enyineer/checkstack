/**
 * Stalled-run sweeper.
 *
 * Periodically scans for runs whose heartbeat is older than a
 * configurable threshold and resumes them. Combined with the per-run
 * Postgres advisory lock, this gives the platform restart safety + safe
 * horizontal scaling: when an instance crashes mid-execution, another
 * instance picks up the dropped runs after the heartbeat threshold
 * elapses.
 *
 * Also sweeps expired wait locks:
 *   - `kind: "delay"` locks past `timeoutAt` resume the run (in case
 *     the queue scheduler lost the job).
 *   - `kind: "trigger"` locks past `timeoutAt` fail the run with a
 *     clear "wait timed out" error.
 *
 * And expired `for:` dwell timers whose `automation-dwell` queue job was
 * lost: each is fired via `fireDwell` (which re-confirms state before
 * starting the run). Idempotent via the dwell row's delete-on-fire.
 */
import type { Logger } from "@checkstack/backend-api";

import type { AutomationStore } from "../automation-store";
import { checkWaitUntil, recoverStalledRun, resumeRun } from "./engine";
import { fireDwell } from "./dwell";
import { startRunRespectingMode } from "./trigger-subscriber";
import type { DispatchDeps } from "./types";

export interface StalledSweeperArgs {
  deps: DispatchDeps;
  automationStore: AutomationStore;
  logger: Logger;
  /** Heartbeat age (ms) above which a run is considered stalled. */
  staleAfterMs?: number;
  /** Poll interval (ms). */
  intervalMs?: number;
}

export interface StalledSweeper {
  /** Run one sweep cycle. Useful in tests. */
  sweep: () => Promise<void>;
  /** Stop the periodic polling. */
  stop: () => void;
}

const DEFAULT_STALE_MS = 60_000; // 1 minute
const DEFAULT_INTERVAL_MS = 30_000; // every 30 seconds

export function startStalledSweeper(
  args: StalledSweeperArgs,
): StalledSweeper {
  const staleMs = args.staleAfterMs ?? DEFAULT_STALE_MS;
  const intervalMs = args.intervalMs ?? DEFAULT_INTERVAL_MS;

  const sweep = async (): Promise<void> => {
    await sweepStalledRuns(args, staleMs);
    await sweepExpiredWaitLocks(args);
    await sweepExpiredDwells(args);
    await sweepWaitUntilLocks(args);
  };

  let timer: ReturnType<typeof setInterval> | undefined = setInterval(() => {
    sweep().catch((error) => {
      args.logger.warn(
        `automation stalled sweeper failed: ${(error as Error).message}`,
      );
    });
  }, intervalMs);

  return {
    sweep,
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

async function sweepStalledRuns(
  args: StalledSweeperArgs,
  staleMs: number,
): Promise<void> {
  const threshold = new Date(Date.now() - staleMs);
  const stalled = await args.deps.runStateStore.findStalledRunIds(threshold);
  if (stalled.length === 0) return;
  args.logger.debug(
    `automation sweeper: ${stalled.length} stalled run(s) detected`,
  );

  for (const runId of stalled) {
    const acquired = await args.deps.runStateStore.tryAdvisoryLock(runId);
    if (!acquired) continue; // another instance already on it
    try {
      const run = await args.deps.runStore.loadRun(runId);
      if (!run) continue;
      const automation = await args.automationStore.getById(run.automationId);
      if (!automation) {
        await args.deps.runStore.updateRunStatus(
          runId,
          "failed",
          "automation deleted while run was stalled",
        );
        await args.deps.runStateStore.clear(runId);
        continue;
      }
      args.logger.info(`automation sweeper: recovering run ${runId}`);
      await recoverStalledRun(args.deps, {
        runId,
        automation: {
          id: automation.id,
          name: automation.name,
          status: automation.status,
          definition: automation.definition,
        },
      });
    } catch (error) {
      args.logger.warn(
        `automation sweeper failed to recover ${runId}: ${(error as Error).message}`,
      );
    } finally {
      await args.deps.runStateStore.releaseAdvisoryLock(runId);
    }
  }
}

async function sweepExpiredWaitLocks(
  args: StalledSweeperArgs,
): Promise<void> {
  const now = new Date();
  const expired = await args.deps.runStore.sweepExpiredWaitLocks(now);
  if (expired.length === 0) return;

  for (const lock of expired) {
    if (lock.kind === "until") {
      // `until` locks are driven by sweepWaitUntilLocks (which applies
      // the continue/fail-on-timeout policy + condition re-check); don't
      // treat a timed-out `until` as a failed trigger here.
      continue;
    }
    if (lock.kind === "delay") {
      // The queue scheduler may have lost the job — wake the run
      // ourselves. Idempotent: resumeRun takes the advisory lock and
      // skips if someone else already resumed.
      const run = await args.deps.runStore.loadRun(lock.runId);
      if (!run) {
        await args.deps.runStore.deleteWaitLock(lock.id);
        continue;
      }
      const automation = await args.automationStore.getById(run.automationId);
      if (!automation) {
        await args.deps.runStore.deleteWaitLock(lock.id);
        continue;
      }
      await args.deps.runStore.deleteWaitLock(lock.id);
      await resumeRun(args.deps, {
        runId: lock.runId,
        automation: {
          id: automation.id,
          name: automation.name,
          status: automation.status,
          definition: automation.definition,
        },
        waitedAtPath: lock.actionPath,
      });
      continue;
    }
    // Trigger lock expired without firing — fail the run.
    await args.deps.runStore.deleteWaitLock(lock.id);
    await args.deps.runStore.updateRunStatus(
      lock.runId,
      "failed",
      `wait_for_trigger timed out waiting for ${lock.eventId}`,
    );
    await args.deps.runStateStore.clear(lock.runId);
  }
}

async function sweepExpiredDwells(
  args: StalledSweeperArgs,
): Promise<void> {
  const now = new Date();
  const expired = await args.deps.dwellStore.sweepExpired(now);
  if (expired.length === 0) return;
  args.logger.debug(
    `automation sweeper: ${expired.length} expired dwell(s) detected`,
  );

  for (const dwell of expired) {
    try {
      await fireDwell({
        deps: args.deps,
        automationStore: args.automationStore,
        dwell,
        startRun: startRunRespectingMode,
      });
    } catch (error) {
      args.logger.warn(
        `automation sweeper failed to fire dwell ${dwell.id}: ${(error as Error).message}`,
      );
    }
  }
}

/**
 * Re-tick `wait_until` locks. The wait-until queue is the primary driver
 * of re-checks; this sweep is the backstop for a lost re-check job (a run
 * with no timeout would otherwise hang forever). Re-checking is idempotent
 * (the lock is deleted before resuming, and `resumeRun` takes the advisory
 * lock), so re-ticking a lock the queue is also about to tick is safe.
 */
async function sweepWaitUntilLocks(
  args: StalledSweeperArgs,
): Promise<void> {
  const locks = await args.deps.runStore.findWaitLocksByKind("until");
  if (locks.length === 0) return;

  for (const lock of locks) {
    try {
      const run = await args.deps.runStore.loadRun(lock.runId);
      if (!run) {
        await args.deps.runStore.deleteWaitLock(lock.id);
        continue;
      }
      const automation = await args.automationStore.getById(run.automationId);
      if (!automation) {
        await args.deps.runStore.deleteWaitLock(lock.id);
        await args.deps.runStore.updateRunStatus(
          lock.runId,
          "failed",
          "automation deleted while run was suspended on wait_until",
        );
        await args.deps.runStateStore.clear(lock.runId);
        continue;
      }
      await checkWaitUntil(args.deps, {
        runId: lock.runId,
        waitLockId: lock.id,
        automation: {
          id: automation.id,
          name: automation.name,
          status: automation.status,
          definition: automation.definition,
        },
      });
    } catch (error) {
      args.logger.warn(
        `automation sweeper failed to re-check wait_until lock ${lock.id}: ${(error as Error).message}`,
      );
    }
  }
}
