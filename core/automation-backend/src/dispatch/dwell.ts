/**
 * Trigger `for:` dwell — "fire only if the matched state still holds
 * after Y" (Home Assistant's `for:`, but restart-safe).
 *
 * A dwell arms BEFORE any run exists, so it lives in its own pre-run
 * `automation_dwell_timers` table (not the run-scoped wait locks). The
 * row is the source of truth; an `automation-dwell` queue job (carrying
 * the matching `startDelay`) is the wake signal, and the stalled sweeper
 * catches expired rows whose job was lost. Cancellation is DB-side: a
 * deleted row makes the queue job no-op when it pops (constraint 2).
 *
 * On expiry the dwell RE-CONFIRMS the system is still in the status it
 * was in when armed (via the Phase 13 health-state provider) before
 * starting the run. A recovery within the dwell window therefore
 * cancels the pending fire even if no explicit inverse event arrived —
 * this is the HA semantic and why Phase 13 is a hard prerequisite.
 */
import { extractErrorMessage, type Actor } from "@checkstack/common";
import {
  durationToMs,
  type Duration,
  type Trigger,
} from "@checkstack/automation-common";

import type { AutomationStore } from "../automation-store";
import type { DispatchDeps, LoadedAutomation, LoadedDwell } from "./types";
import { parseActorSnapshot } from "./snapshots";

/** Queue carrying dwell wake-up jobs. */
export const DWELL_QUEUE_NAME = "automation-dwell";

/** Payload of a dwell wake-up job. The row is loaded fresh on firing. */
export interface DwellFireJob {
  dwellId: string;
}

export interface ArmDwellArgs {
  deps: DispatchDeps;
  automation: LoadedAutomation;
  trigger: Trigger;
  triggerId: string;
  eventId: string;
  contextKey: string | null;
  triggerPayload: Record<string, unknown>;
  actor: Actor;
}

/**
 * Arm (or re-arm) a dwell for a `for:`-configured trigger. Snapshots the
 * system's current status so expiry can re-confirm it, upserts the dwell
 * row (re-fire pushes `fireAt`), and enqueues the wake job. Does NOT
 * start a run.
 */
export async function armDwell(args: ArmDwellArgs): Promise<void> {
  const { deps, automation, trigger, triggerId, eventId, contextKey } = args;
  if (!trigger.for) return;

  const forMs = durationToMs(trigger.for as Duration);
  if (forMs === null || forMs <= 0) {
    deps.logger.warn(
      `Dwell for ${automation.id}/${triggerId} has an invalid duration; firing immediately is unsafe, skipping arm`,
    );
    return;
  }

  // Snapshot the current status so the expiry re-confirm has something to
  // gate on. Best-effort: a missing client / unresolvable system leaves
  // armedStatus null and re-confirm proceeds without a status gate.
  const armedStatus = await resolveArmedStatus({
    deps,
    contextKey,
  });

  const fireAt = new Date(Date.now() + forMs);
  const { id: dwellId, created } = await deps.dwellStore.arm({
    automationId: automation.id,
    triggerId,
    eventId,
    contextKey,
    armedStatus,
    payloadSnapshot: args.triggerPayload,
    actorSnapshot: args.actor as unknown as Record<string, unknown>,
    fireAt,
  });

  // Continuation: a dwell is already armed for this key. Its original
  // deadline + queue job stand, so the `for:` window measures "since
  // first arm" (HA semantics). Re-arming MUST NOT push `fireAt`, or a
  // continuously re-firing trigger (e.g. level-triggered numeric_state)
  // would never elapse.
  if (!created) {
    deps.logger.debug(
      `Dwell for ${automation.id}/${triggerId} already armed; preserving original deadline`,
    );
    return;
  }

  const queue = deps.queueManager.getQueue<DwellFireJob>(DWELL_QUEUE_NAME);
  await queue.enqueue(
    { dwellId },
    {
      startDelay: Math.ceil(forMs / 1000),
      // Stable per (automation, trigger, contextKey) — the sweeper is the
      // backstop if the job is ever lost.
      jobId: `${automation.id}:${triggerId}:${contextKey ?? "_"}`,
    },
  );

  deps.logger.debug(
    `Armed dwell ${dwellId} for ${automation.id}/${triggerId} (fires in ${Math.round(forMs / 1000)}s, armedStatus=${armedStatus ?? "none"})`,
  );
}

async function resolveArmedStatus(args: {
  deps: DispatchDeps;
  contextKey: string | null;
}): Promise<string | null> {
  const { deps, contextKey } = args;
  if (!deps.healthCheckClient || !contextKey) return null;
  try {
    const state = await deps.healthCheckClient.getHealthState({
      systemId: contextKey,
    });
    return state.status;
  } catch (error) {
    deps.logger.warn(
      `Dwell arm: failed to resolve status for ${contextKey}; arming without a status gate: ${extractErrorMessage(error)}`,
    );
    return null;
  }
}

/**
 * Callback that starts a run for a fired dwell, honouring the
 * automation's concurrency mode + pre-run conditions. Supplied by the
 * trigger subscriber so the dwell module stays free of the concurrency /
 * condition machinery.
 */
export type StartRunFromDwell = (args: {
  deps: DispatchDeps;
  automation: LoadedAutomation;
  trigger: Trigger;
  triggerId: string;
  eventId: string;
  contextKey: string | null;
  triggerPayload: Record<string, unknown>;
  actor: Actor;
}) => Promise<void>;

export interface FireDwellArgs {
  deps: DispatchDeps;
  automationStore: AutomationStore;
  dwell: LoadedDwell;
  startRun: StartRunFromDwell;
}

/**
 * Fire an expired dwell: re-confirm the system is still in the armed
 * status, then (if it is) start the run. Always deletes the dwell row
 * first so a concurrent sweeper / consumer can't double-fire (the row is
 * the lock).
 */
export async function fireDwell(args: FireDwellArgs): Promise<void> {
  const { deps, automationStore, dwell, startRun } = args;

  // Delete-first makes firing idempotent AND mutually exclusive: the
  // delete is an atomic claim (DELETE ... RETURNING), so only the caller
  // whose delete actually removed the row proceeds. A racing
  // consumer/sweeper (even on another pod) gets `false` and no-ops,
  // preventing a double-fire.
  const claimed = await deps.dwellStore.delete(dwell.id);
  if (!claimed) {
    deps.logger.debug(
      `Dwell ${dwell.id} already claimed by a concurrent fire; skipping`,
    );
    return;
  }

  const automation = await automationStore.getById(dwell.automationId);
  if (!automation || automation.status !== "enabled") {
    deps.logger.debug(
      `Dwell ${dwell.id} fired but automation ${dwell.automationId} is gone/disabled; dropping`,
    );
    return;
  }

  const trigger = automation.definition.triggers.find((t) => {
    const tid = t.id ?? deriveTriggerId(t.event);
    return tid === dwell.triggerId && t.event === dwell.eventId;
  });
  if (!trigger) {
    deps.logger.debug(
      `Dwell ${dwell.id} fired but trigger ${dwell.triggerId} no longer exists on the automation; dropping`,
    );
    return;
  }

  // Re-confirm: only proceed if the system is STILL in the armed status.
  if (!(await reconfirmStatus({ deps, dwell }))) {
    deps.logger.debug(
      `Dwell ${dwell.id} re-confirm failed (system left status "${dwell.armedStatus}"); not firing`,
    );
    return;
  }

  await startRun({
    deps,
    automation: {
      id: automation.id,
      name: automation.name,
      status: automation.status,
      definition: automation.definition,
      runAs: automation.runAs ?? null,
    },
    trigger,
    triggerId: dwell.triggerId,
    eventId: dwell.eventId,
    contextKey: dwell.contextKey,
    triggerPayload: dwell.payloadSnapshot,
    // Parse the stored actor on load — a drifted/hand-edited snapshot
    // degrades to the system actor (logged) instead of flowing through as
    // an untyped value.
    actor: parseActorSnapshot({
      value: dwell.actorSnapshot,
      logger: deps.logger,
      context: `Dwell ${dwell.id}`,
    }),
  });
}

async function reconfirmStatus(args: {
  deps: DispatchDeps;
  dwell: LoadedDwell;
}): Promise<boolean> {
  const { deps, dwell } = args;
  // No status was captured at arm time (no client / unresolvable system):
  // proceed without a gate — the pre-run conditions still apply downstream.
  if (dwell.armedStatus === null) return true;
  if (!deps.healthCheckClient || !dwell.contextKey) return true;
  try {
    const state = await deps.healthCheckClient.getHealthState({
      systemId: dwell.contextKey,
    });
    return state.status === dwell.armedStatus;
  } catch (error) {
    // Fail-open: a provider outage at expiry should not silently drop a
    // legitimate alert. Proceed and let downstream conditions decide.
    deps.logger.warn(
      `Dwell ${dwell.id} re-confirm errored; proceeding (fail-open): ${extractErrorMessage(error)}`,
    );
    return true;
  }
}

/** Mirror of the dispatcher's id derivation (kept local to avoid a cycle). */
function deriveTriggerId(event: string): string {
  return event.replaceAll(/[^a-z0-9]+/gi, "_").toLowerCase();
}
