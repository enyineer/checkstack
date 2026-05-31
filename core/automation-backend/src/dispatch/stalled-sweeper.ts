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
 *   - `kind: "until"` locks past `timeoutAt` apply the wait_until timeout
 *     policy via `checkWaitUntil` (continue / fail). This is the BACKSTOP
 *     for a lost timeout-timer job — a reactive `wait_until` is otherwise
 *     event-driven (Stage-1 wake), with no periodic re-check (reactive
 *     automation engine §7).
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

/**
 * TTL for windowed-count occurrence rows. A row older than the maximum
 * window any trigger can configure (the 1440-minute / 24h `WindowSchema`
 * cap) can never contribute to an in-window count, so it is dead and prunable.
 * Config-independent: pruning at the schema cap is always safe without
 * reading any automation's actual window.
 */
const WINDOW_EVENT_TTL_MS = 24 * 60 * 60_000; // 24 hours (the WindowSchema cap)

export function startStalledSweeper(
  args: StalledSweeperArgs,
): StalledSweeper {
  const staleMs = args.staleAfterMs ?? DEFAULT_STALE_MS;
  const intervalMs = args.intervalMs ?? DEFAULT_INTERVAL_MS;

  const sweep = async (): Promise<void> => {
    // Wait-aware sweeps run FIRST: they own `waiting` runs (delay / trigger
    // / until expiry + resume). The stalled-run sweep is strictly for
    // genuinely-`running` crashes and must not race ahead of them. (It now
    // also filters to status='running', so it can't pick up a waiting run,
    // but ordering keeps the wait paths authoritative within a cycle.)
    await sweepExpiredWaitLocks(args);
    await sweepExpiredDwells(args);
    await sweepExpiredWindowEvents(args);
    await sweepStalledRuns(args, staleMs);
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
    const lock = await args.deps.runStateStore.tryAdvisoryLock(runId);
    if (!lock) continue; // another instance already on it
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
      await lock.release();
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
      // Backstop for a lost timeout-timer job: apply the wait_until timeout
      // policy via checkWaitUntil (it re-evaluates one last time, then
      // resumes-or-fails per continue_on_timeout). Idempotent. A reactive
      // `until` lock without a timeout has no `timeoutAt`, so it never lands
      // here — it is purely event-driven (Stage-1 wake).
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
 * Prune windowed-count occurrence rows older than the 24h `WindowSchema`
 * cap. Such rows can never contribute to any in-window count, so the delete
 * is config-independent and safe. A bulk indexed range delete (`pruneIdx`);
 * idempotent and cheap when there's nothing to prune.
 */
async function sweepExpiredWindowEvents(
  args: StalledSweeperArgs,
): Promise<void> {
  const cutoff = new Date(Date.now() - WINDOW_EVENT_TTL_MS);
  try {
    await args.deps.windowStore.sweepExpired(cutoff);
  } catch (error) {
    args.logger.warn(
      `automation sweeper failed to prune window events: ${(error as Error).message}`,
    );
  }
}

