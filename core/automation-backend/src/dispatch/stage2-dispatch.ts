/**
 * Stage-2 dispatch fan-out (reactive automation engine §7, §13).
 *
 * Stage 1 (the `ENTITY_CHANGED` work-queue router) does only cheap indexed
 * routing and enqueues one Stage-2 job per interested automation / waiting
 * run onto the `automation-dispatch` queue. This consumer runs those jobs:
 * any instance picks one up, so execution load spreads while Stage 1 stays
 * fast.
 *
 * The job is a validated {@link DispatchJob}; the handler routes on `reason`:
 *   - `"trigger"` → start fresh run(s) for the matched automation
 *     (`startRunsForAutomationEvent`, which honours the trigger config gate,
 *     filter, dwell, and concurrency mode).
 *   - `"wake"`    → resume the suspended `wait_until` (`checkWaitUntil`,
 *     which re-enriches scope, re-evaluates, and resumes or fails-on-timeout;
 *     idempotent via the per-run advisory lock).
 *
 * Mirrors the delay / dwell consumer wiring. `consumerGroup:
 * "automation-dispatch-run"`, `maxRetries: 3`.
 */
import type { Logger } from "@checkstack/backend-api";
import {
  DispatchJobSchema,
  type DispatchJob,
  type EntityChanged,
} from "@checkstack/automation-common";

import type { AutomationStore } from "../automation-store";
import { checkWaitUntil } from "./engine";
import { startRunsForAutomationEvent } from "./trigger-subscriber";
import type { DispatchDeps, LoadedAutomation } from "./types";

/** Durable Stage-2 queue name (reactive automation engine §13.1). */
export const DISPATCH_QUEUE_NAME = "automation-dispatch";

export interface DispatchQueueConsumerArgs {
  deps: DispatchDeps;
  automationStore: AutomationStore;
  logger: Logger;
}

export interface DispatchQueueConsumer {
  stop: () => Promise<void>;
}

/** The entity-change payload becomes the trigger payload for a fresh run. */
function changedToPayload(changed: EntityChanged): Record<string, unknown> {
  // Expose the change in a shape automations can read: the entity id + the
  // new state fields (or a tombstone marker), plus the kind for clarity.
  return {
    kind: changed.kind,
    id: changed.id,
    prev: changed.prev,
    next: changed.next,
    delta: changed.delta,
    changedFields: changed.changedFields,
    // Convenience: spread the next state at the top level so existing
    // payload-reading templates (`trigger.payload.status`) keep working
    // when the change is a state update.
    ...(changed.next === null ? {} : changed.next),
  };
}

async function loadAutomation(
  automationStore: AutomationStore,
  automationId: string,
): Promise<LoadedAutomation | undefined> {
  const automation = await automationStore.getById(automationId);
  if (!automation) return undefined;
  return {
    id: automation.id,
    name: automation.name,
    status: automation.status,
    definition: automation.definition,
  };
}

/**
 * Handle one Stage-2 job. Exported (not just the consumer) so tests can
 * drive it directly without a real queue.
 */
export async function handleDispatchJob(args: {
  deps: DispatchDeps;
  automationStore: AutomationStore;
  job: DispatchJob;
}): Promise<void> {
  const { deps, automationStore, job } = args;

  if (job.reason === "trigger") {
    const automation = await loadAutomation(automationStore, job.automationId);
    if (!automation) {
      deps.logger.debug(
        `stage2: automation ${job.automationId} gone; dropping trigger job`,
      );
      return;
    }
    // Only enabled automations dispatch (disabled = paused).
    if (automation.status !== "enabled") return;
    await startRunsForAutomationEvent({
      deps,
      automation,
      eventId: job.triggerId,
      triggerPayload: changedToPayload(job.changed),
      actor: job.changed.actor,
      contextKey: job.changed.id,
    });
    return;
  }

  // reason === "wake": resume a suspended wait_until.
  const lock = await deps.runStore.loadWaitLock(job.waitLockId);
  if (!lock || lock.kind !== "until") {
    deps.logger.debug(
      `stage2: wait lock ${job.waitLockId} gone (resumed / cancelled); dropping wake job`,
    );
    return;
  }
  const run = await deps.runStore.loadRun(job.runId);
  if (!run) {
    await deps.runStore.deleteWaitLock(job.waitLockId);
    return;
  }
  const automation = await loadAutomation(automationStore, run.automationId);
  if (!automation) {
    await deps.runStore.deleteWaitLock(job.waitLockId);
    await deps.runStore.updateRunStatus(
      job.runId,
      "failed",
      "automation deleted while run was suspended on wait_until",
    );
    await deps.runStateStore.clear(job.runId);
    return;
  }
  // checkWaitUntil re-enriches scope, re-evaluates the full condition, and
  // resumes (or applies timeout). Idempotent: it deletes the lock before
  // resuming and resumeRun takes the per-run advisory lock.
  await checkWaitUntil(deps, {
    runId: job.runId,
    waitLockId: job.waitLockId,
    automation,
  });
}

export async function startDispatchQueueConsumer(
  args: DispatchQueueConsumerArgs,
): Promise<DispatchQueueConsumer> {
  const queue = args.deps.queueManager.getQueue<DispatchJob>(
    DISPATCH_QUEUE_NAME,
  );

  await queue.consume(
    async (rawJob) => {
      const parsed = DispatchJobSchema.safeParse(rawJob.data);
      if (!parsed.success) {
        args.logger.warn(
          `stage2: dropping malformed automation-dispatch job: ${parsed.error.message}`,
        );
        return;
      }
      await handleDispatchJob({
        deps: args.deps,
        automationStore: args.automationStore,
        job: parsed.data,
      });
    },
    { consumerGroup: "automation-dispatch-run", maxRetries: 3 },
  );

  return {
    stop: async () => {
      await queue.stop();
    },
  };
}
