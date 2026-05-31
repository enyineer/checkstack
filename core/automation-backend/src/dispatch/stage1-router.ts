/**
 * Stage-1 routing (reactive automation engine §7, §13).
 *
 * Subscribes to the internal `ENTITY_CHANGED` hook in work-queue mode
 * (`workerGroup: "automation-entity-route"`) so exactly ONE instance claims
 * each change. The claimer does only cheap, indexed routing:
 *
 *   (a) Waiting runs — wake-index intersection lookup (§8.2): every
 *       `kind:"until"` wait lock whose dependency set includes the changed
 *       `${kind}:${id}` ref (or the kind-level wildcard). One Stage-2 `wake`
 *       job is enqueued per matching lock.
 *   (b) Fresh-run triggers — the change is run through the per-kind
 *       trigger-event deriver registry (§ change-derivers) to get the
 *       qualified trigger event id(s); each id is fanned out to the enabled
 *       automations referencing it (`findEnabledByTriggerEvent`). One
 *       Stage-2 `trigger` job is enqueued per (automation, event) match.
 *
 * Stage 1 never executes a run — it only enqueues Stage-2 jobs onto the
 * `automation-dispatch` queue, keeping the claim fast.
 */
import type { HookEventMeta, Logger } from "@checkstack/backend-api";
import {
  EntityChangedSchema,
  type DispatchJob,
  type EntityChanged,
} from "@checkstack/automation-common";

import type { AutomationStore } from "../automation-store";
import type { ChangeDeriverRegistry } from "../entity/change-derivers";
import { ENTITY_CHANGED_HOOK } from "../entity/hook";
import { DISPATCH_QUEUE_NAME } from "./stage2-dispatch";
import type { DispatchDeps } from "./types";

/** Worker group for the Stage-1 claim (reactive automation engine §13.1). */
export const ENTITY_ROUTE_WORKER_GROUP = "automation-entity-route";

/** Type of `onHook` injected in afterPluginsReady (mirrors backend-api). */
export type OnHookFn = <T>(
  hook: { id: string; _type?: T },
  listener: (payload: T, meta?: HookEventMeta) => Promise<void>,
  options?:
    | { mode?: "broadcast"; maxRetries?: number }
    | { mode: "work-queue"; workerGroup: string; maxRetries?: number }
    | { mode: "instance-local" },
) => () => Promise<void>;

export interface Stage1RouterArgs {
  deps: DispatchDeps;
  automationStore: AutomationStore;
  changeDerivers: ChangeDeriverRegistry;
  onHook: OnHookFn;
  logger: Logger;
}

export interface Stage1Router {
  dispose: () => Promise<void>;
}

/**
 * Route one validated entity change to Stage-2 jobs. Exported so tests can
 * drive routing directly (without a real hook bus); returns the jobs it
 * enqueued for assertion.
 */
export async function routeEntityChange(args: {
  deps: DispatchDeps;
  automationStore: AutomationStore;
  changeDerivers: ChangeDeriverRegistry;
  changed: EntityChanged;
}): Promise<DispatchJob[]> {
  const { deps, automationStore, changeDerivers, changed } = args;
  const ref = `${changed.kind}:${changed.id}`;
  const queue = deps.queueManager.getQueue<DispatchJob>(DISPATCH_QUEUE_NAME);
  const enqueued: DispatchJob[] = [];

  // (a) Waiting runs depending on this ref (or the kind wildcard).
  const waits = await deps.runStore.findWaitLocksByWakeRef(ref);
  for (const lock of waits) {
    const job: DispatchJob = {
      reason: "wake",
      runId: lock.runId,
      waitLockId: lock.id,
      ref,
      changed,
    };
    await queue.enqueue(job, {
      // One in-flight wake per (lock, ref) — a duplicate change for the same
      // ref collapses onto the same job id.
      jobId: `wake:${lock.id}:${ref}`,
    });
    enqueued.push(job);
  }

  // (b) Fresh-run triggers — derive the qualified trigger event id(s).
  const eventIds = changeDerivers.derive(changed);
  for (const eventId of eventIds) {
    const automations = await automationStore.findEnabledByTriggerEvent(eventId);
    for (const automation of automations) {
      const job: DispatchJob = {
        reason: "trigger",
        automationId: automation.id,
        triggerId: eventId,
        ref,
        changed,
      };
      await queue.enqueue(job, {
        jobId: `trigger:${automation.id}:${eventId}:${ref}:${changed.occurredAt}`,
      });
      enqueued.push(job);
    }
  }

  if (enqueued.length > 0) {
    deps.logger.debug(
      `stage1: routed ${ref} → ${enqueued.length} dispatch job(s) (${waits.length} wake, ${enqueued.length - waits.length} trigger)`,
    );
  }
  return enqueued;
}

export async function startStage1Router(
  args: Stage1RouterArgs,
): Promise<Stage1Router> {
  const unsub = args.onHook(
    ENTITY_CHANGED_HOOK,
    async (payload) => {
      const parsed = EntityChangedSchema.safeParse(payload);
      if (!parsed.success) {
        args.logger.warn(
          `stage1: dropping malformed ENTITY_CHANGED payload: ${parsed.error.message}`,
        );
        return;
      }
      await routeEntityChange({
        deps: args.deps,
        automationStore: args.automationStore,
        changeDerivers: args.changeDerivers,
        changed: parsed.data,
      });
    },
    { mode: "work-queue", workerGroup: ENTITY_ROUTE_WORKER_GROUP },
  );

  return {
    dispose: async () => {
      await unsub();
    },
  };
}
