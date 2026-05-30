/**
 * Trigger fan-in for the automation dispatch engine.
 *
 * Subscribes to every registered hook-backed trigger in `afterPluginsReady`,
 * routes each emission to the matching enabled automations, and respects
 * each automation's concurrency mode (single / parallel / queued / restart).
 *
 * Also handles `wait_for_trigger` resumption: every incoming event is
 * cross-referenced against `automation_wait_locks` and matching waits
 * are woken up.
 */
import type {
  AutomationMode,
  Trigger,
} from "@checkstack/automation-common";
import type {
  HookEventMeta,
  HookSubscribeOptions,
  Logger,
} from "@checkstack/backend-api";
import { SYSTEM_ACTOR, type Actor } from "@checkstack/common";

import type { AutomationStore } from "../automation-store";
import { dispatchTrigger, resumeRun } from "./engine";
import { evaluateCondition } from "./condition";
import { renderString } from "./render";
import { buildInitialScope } from "./scope";
import { enrichScopeWithState } from "./state-scope";
import { armDwell, type StartRunFromDwell } from "./dwell";
import type {
  DispatchDeps,
  LoadedAutomation,
} from "./types";

/**
 * Subscription handle returned by `setupTriggerSubscriptions`. Calling
 * `dispose()` unsubscribes every hook and tears down every setup-backed
 * trigger. Used at shutdown.
 */
export interface TriggerSubscriptions {
  dispose: () => Promise<void>;
}

/**
 * Type of `onHook` injected by the plugin runtime in afterPluginsReady.
 * Mirrors the shape from `@checkstack/backend-api` — note that the
 * call returns a sync `HookUnsubscribe` (an async function), not a
 * Promise<HookUnsubscribe>.
 */
export type OnHookFn = <T>(
  hook: { id: string; _type?: T },
  listener: (payload: T, meta?: HookEventMeta) => Promise<void>,
  options?: HookSubscribeOptions,
) => () => Promise<void>;

export interface SetupTriggerSubscriptionsArgs {
  deps: DispatchDeps;
  onHook: OnHookFn;
  automationStore: AutomationStore;
  logger: Logger;
}

export async function setupTriggerSubscriptions(
  args: SetupTriggerSubscriptionsArgs,
): Promise<TriggerSubscriptions> {
  const teardowns: Array<() => Promise<void>> = [];

  const triggers = args.deps.registries.triggers.getTriggers();
  args.logger.debug(
    `⚙️  Setting up ${triggers.length} automation trigger subscriptions`,
  );

  for (const trigger of triggers) {
    if (trigger.hook) {
      const teardown = args.onHook(
        trigger.hook,
        async (payload, meta) => {
          await handleTriggerFiring({
            deps: args.deps,
            automationStore: args.automationStore,
            qualifiedEventId: trigger.qualifiedId,
            triggerPayload: payload as Record<string, unknown>,
            actor: meta?.actor ?? SYSTEM_ACTOR,
            contextKey:
              (trigger.contextKey?.(payload) ?? null),
          });
        },
        {
          mode: "work-queue",
          workerGroup: `automation-trigger-${trigger.qualifiedId}`,
        },
      );
      teardowns.push(teardown);
      continue;
    }

    // Setup-backed triggers (cron, interval, template) — instantiate one
    // setup per (automation, triggerConfig) pair across enabled
    // automations referencing this trigger.
    if (trigger.setup) {
      const automations = await args.automationStore.listEnabled();
      const referencing = automations.filter((a) =>
        a.definition.triggers.some((t) => t.event === trigger.qualifiedId),
      );
      for (const automation of referencing) {
        for (const t of automation.definition.triggers.filter(
          (t) => t.event === trigger.qualifiedId,
        )) {
          const triggerId = t.id ?? deriveTriggerId(t);
          const teardown = await trigger.setup({
            config: t.config as never,
            identity: {
              automationId: automation.id,
              triggerId,
            },
            fire: async (payload) => {
              await handleTriggerFiring({
                deps: args.deps,
                automationStore: args.automationStore,
                qualifiedEventId: trigger.qualifiedId,
                triggerPayload: payload as Record<string, unknown>,
                // Setup-backed triggers (cron / interval / template) fire on a
                // schedule with no acting caller — the system is the actor.
                actor: SYSTEM_ACTOR,
                contextKey:
                  trigger.contextKey?.(payload) ?? null,
              });
            },
            logger: args.logger,
          });
          teardowns.push(teardown);
        }
      }
    }
  }

  return {
    dispose: async () => {
      for (const teardown of teardowns.toReversed()) {
        try {
          await teardown();
        } catch (error) {
          args.logger.warn(
            `Failed to tear down trigger subscription: ${(error as Error).message}`,
          );
        }
      }
    },
  };
}

export interface HandleTriggerFiringArgs {
  deps: DispatchDeps;
  automationStore: AutomationStore;
  qualifiedEventId: string;
  triggerPayload: Record<string, unknown>;
  actor: Actor;
  contextKey: string | null;
}

export async function handleTriggerFiring(
  args: HandleTriggerFiringArgs,
): Promise<void> {
  // ── Step 1: resume any waiting runs ──
  await wakeWaitingRuns(args);

  // ── Step 2: route to fresh runs for automations referencing this event ──
  const matches = await args.automationStore.findEnabledByTriggerEvent(
    args.qualifiedEventId,
  );

  for (const automation of matches) {
    for (const trigger of automation.definition.triggers.filter(
      (t) => t.event === args.qualifiedEventId,
    )) {
      await maybeStartRun({
        deps: args.deps,
        automation,
        trigger,
        triggerPayload: args.triggerPayload,
        actor: args.actor,
        contextKey: args.contextKey,
        eventId: args.qualifiedEventId,
      });
    }
  }

  // ── Step 3: eager inverse-cancel ──
  // A state-change event may be the natural inverse of an armed dwell
  // (e.g. `system.healthy` cancels a `system.degraded` + for: dwell on
  // the same automation + system). The expiry re-confirm would catch
  // this anyway, but cancelling now deletes the dwell row so its queue
  // job no-ops promptly instead of waking and re-checking later.
  await cancelStaleDwells(args);
}

/**
 * For every automation referencing the firing event with a `for:` dwell
 * armed on the same context key, re-confirm the system's current status;
 * if it no longer matches the dwell's `armedStatus`, cancel the dwell.
 * Bounded to the matching automations and skipped entirely when no
 * health client is wired (nothing to re-confirm against).
 */
async function cancelStaleDwells(
  args: HandleTriggerFiringArgs,
): Promise<void> {
  const client = args.deps.healthCheckClient;
  if (!client || args.contextKey === null) return;

  const matches = await args.automationStore.findEnabledByTriggerEvent(
    args.qualifiedEventId,
  );

  let currentStatus: string | undefined;
  for (const automation of matches) {
    for (const trigger of automation.definition.triggers) {
      if (!trigger.for) continue;
      const triggerId = trigger.id ?? deriveTriggerId(trigger);
      const dwell = await args.deps.dwellStore.findByKey(
        automation.id,
        triggerId,
        args.contextKey,
      );
      if (!dwell || dwell.armedStatus === null) continue;

      // Resolve current status once per firing (cheap memoised lookup).
      if (currentStatus === undefined) {
        try {
          const state = await client.getHealthState({
            systemId: args.contextKey,
          });
          currentStatus = state.status;
        } catch {
          return; // can't re-confirm — leave the dwell for expiry.
        }
      }

      if (currentStatus !== dwell.armedStatus) {
        await args.deps.dwellStore.delete(dwell.id);
        args.deps.logger.debug(
          `Cancelled dwell ${dwell.id} (${automation.id}/${triggerId}): system ${args.contextKey} left status "${dwell.armedStatus}" (now "${currentStatus}")`,
        );
      }
    }
  }
}

async function wakeWaitingRuns(args: HandleTriggerFiringArgs): Promise<void> {
  const matches = await args.deps.runStore.findWaitLocksFor(
    args.qualifiedEventId,
    args.contextKey,
  );
  if (matches.length === 0) return;

  for (const lock of matches) {
    // Evaluate filter template if present.
    if (lock.filterTemplate) {
      try {
        const ctx = buildInitialScope({
          triggerId: "wait",
          triggerEventId: args.qualifiedEventId,
          payload: args.triggerPayload,
          actor: args.actor,
          startedAt: new Date(),
        });
        await enrichScopeWithState({
          scope: ctx,
          client: args.deps.healthCheckClient,
          logger: args.deps.logger,
          contextKey: args.contextKey,
        });
        const pass = evaluateCondition(
          lock.filterTemplate,
          ctx,
          args.deps.filters,
        );
        if (!pass) continue;
      } catch (error) {
        args.deps.logger.warn(
          `wait_for_trigger filter failed to evaluate; skipping resume: ${(error as Error).message}`,
        );
        continue;
      }
    }

    // Load the automation so we have the definition to resume against.
    const run = await args.deps.runStore.loadRun(lock.runId);
    if (!run) continue;
    const automation = await args.automationStore.getById(run.automationId);
    if (!automation) continue;

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
      payload: args.triggerPayload,
    });
  }
}

interface MaybeStartRunArgs {
  deps: DispatchDeps;
  automation: LoadedAutomation;
  trigger: Trigger;
  triggerPayload: Record<string, unknown>;
  actor: Actor;
  contextKey: string | null;
  eventId: string;
}

async function maybeStartRun(args: MaybeStartRunArgs): Promise<void> {
  // Structured config gate (e.g. numeric_state's above/below threshold).
  // Runs before the operator's template filter. A registered trigger that
  // declares `evaluateConfig` decides per-automation whether this payload
  // fires, using the trigger's typed `config`.
  const registered = args.deps.registries.triggers.getTrigger(args.eventId);
  if (registered?.evaluateConfig) {
    let pass: boolean;
    try {
      pass = registered.evaluateConfig(
        args.triggerPayload,
        args.trigger.config,
      );
    } catch (error) {
      args.deps.logger.warn(
        `Trigger config gate threw; skipping firing: ${(error as Error).message}`,
      );
      return;
    }
    if (!pass) return;
  }

  // Trigger-level filter gates BOTH the immediate run and arming a dwell.
  // (Conditions, by contrast, gate the run itself and are evaluated at
  // fire time so a dwell re-checks them after the duration.)
  if (args.trigger.filter) {
    const filterScope = buildInitialScope({
      triggerId: args.trigger.id ?? deriveTriggerId(args.trigger),
      triggerEventId: args.eventId,
      payload: args.triggerPayload,
      actor: args.actor,
      startedAt: new Date(),
    });
    await enrichScopeWithState({
      scope: filterScope,
      client: args.deps.healthCheckClient,
      logger: args.deps.logger,
      contextKey: args.contextKey,
      usesState: args.automation.definition.uses_state,
      transitionWindowMinutes: args.automation.definition.state_window_minutes,
    });
    let pass: boolean;
    try {
      pass = evaluateCondition(
        args.trigger.filter,
        filterScope,
        args.deps.filters,
      );
    } catch (error) {
      args.deps.logger.warn(
        `Trigger filter failed to evaluate; skipping firing: ${(error as Error).message}`,
      );
      return;
    }
    if (!pass) return;
  }

  // `for:` dwell — arm (or re-arm) instead of starting the run now. The
  // run starts only if the matched state still holds after the duration.
  if (args.trigger.for) {
    await armDwell({
      deps: args.deps,
      automation: args.automation,
      trigger: args.trigger,
      triggerId: args.trigger.id ?? deriveTriggerId(args.trigger),
      eventId: args.eventId,
      contextKey: args.contextKey,
      triggerPayload: args.triggerPayload,
      actor: args.actor,
    });
    return;
  }

  await startRunRespectingMode({
    deps: args.deps,
    automation: args.automation,
    trigger: args.trigger,
    triggerId: args.trigger.id ?? deriveTriggerId(args.trigger),
    eventId: args.eventId,
    contextKey: args.contextKey,
    triggerPayload: args.triggerPayload,
    actor: args.actor,
  });
}

/**
 * Evaluate the automation's pre-run conditions (against freshly-enriched
 * scope) and, if they pass, dispatch a run honouring the concurrency
 * mode. Shared by the immediate trigger path and the dwell-fire path
 * (so a dwell re-checks conditions at expiry, not at arm time).
 */
export const startRunRespectingMode: StartRunFromDwell = async (args) => {
  // Top-level conditions gate the run, evaluated against enriched scope.
  if (args.automation.definition.conditions.length > 0) {
    const gateScope = buildInitialScope({
      triggerId: args.triggerId,
      triggerEventId: args.eventId,
      payload: args.triggerPayload,
      actor: args.actor,
      startedAt: new Date(),
    });
    await enrichScopeWithState({
      scope: gateScope,
      client: args.deps.healthCheckClient,
      logger: args.deps.logger,
      contextKey: args.contextKey,
      usesState: args.automation.definition.uses_state,
      transitionWindowMinutes: args.automation.definition.state_window_minutes,
    });
    for (const condition of args.automation.definition.conditions) {
      try {
        const pass = evaluateCondition(
          condition,
          gateScope,
          args.deps.filters,
        );
        if (!pass) return;
      } catch {
        return;
      }
    }
  }

  await respectConcurrencyMode({
    deps: args.deps,
    automationId: args.automation.id,
    mode: args.automation.definition.mode,
    maxRuns: args.automation.definition.max_runs,
    triggerId: args.triggerId,
    triggerEventId: args.eventId,
    triggerPayload: args.triggerPayload,
    actor: args.actor,
    contextKey: args.contextKey,
    automation: args.automation,
  });
};

interface RespectConcurrencyArgs {
  deps: DispatchDeps;
  automationId: string;
  automation: LoadedAutomation;
  mode: AutomationMode;
  maxRuns: number;
  triggerId: string;
  triggerEventId: string;
  triggerPayload: Record<string, unknown>;
  actor: Actor;
  contextKey: string | null;
}

async function respectConcurrencyMode(
  args: RespectConcurrencyArgs,
): Promise<void> {
  switch (args.mode) {
    case "single": {
      const active = await args.deps.runStore.hasActiveRun(args.automationId);
      if (active) {
        args.deps.logger.debug(
          `Skipping trigger for ${args.automationId} — single mode and a run is active`,
        );
        return;
      }
      break;
    }
    case "parallel": {
      const count = await args.deps.runStore.countActiveRuns(args.automationId);
      if (count >= args.maxRuns) {
        args.deps.logger.debug(
          `Skipping trigger for ${args.automationId} — parallel limit reached (${count}/${args.maxRuns})`,
        );
        return;
      }
      break;
    }
    case "queued": {
      // v1: queued behaves like parallel within max_runs. Real FIFO
      // queueing requires its own coordination queue, which we add in a
      // follow-up. Behaviour stays correct (no double-fire) under the
      // existing work-queue mode.
      const count = await args.deps.runStore.countActiveRuns(args.automationId);
      if (count >= args.maxRuns) return;
      break;
    }
    case "restart": {
      const cancelled = await args.deps.runStore.cancelActiveRuns(
        args.automationId,
        "restart — superseded by newer trigger",
      );
      if (cancelled.length > 0) {
        args.deps.logger.debug(
          `Restart mode: cancelled ${cancelled.length} prior run(s) for ${args.automationId}`,
        );
      }
      break;
    }
  }

  await dispatchTrigger(args.deps, {
    automation: args.automation,
    triggerId: args.triggerId,
    triggerEventId: args.triggerEventId,
    payload: args.triggerPayload,
    actor: args.actor,
    contextKey: args.contextKey,
  });
}

// Suppress unused warning for renderString — the helper is exported via
// scope.ts and used by the engine's primitives; trigger-subscriber
// doesn't currently render templates beyond conditions, but the import
// is convenient for future filter expressions.
void renderString;

/**
 * Derive a stable trigger id from the trigger declaration when the
 * operator hasn't assigned one. Slugifies the event id; collisions
 * within a single automation are the operator's responsibility (the
 * editor surfaces the `id` field as soon as a duplicate appears).
 */
function deriveTriggerId(trigger: Trigger): string {
  return trigger.event.replaceAll(/[^a-z0-9]+/gi, "_").toLowerCase();
}
