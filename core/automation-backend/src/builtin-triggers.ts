/**
 * Built-in triggers shipped by automation-backend itself.
 *
 * Three triggers, all setup-backed (no plugin hook to subscribe to):
 *
 *   - `time.cron` — recurring queue job on a cron pattern.
 *   - `time.interval` — recurring queue job on a fixed interval.
 *   - `template` — interval-based polling; evaluates a template on each
 *     tick and fires on the false → true edge (so an automation
 *     subscribing on "value template is truthy" doesn't re-fire while
 *     the value stays truthy).
 *
 * All three share the same two-stage runtime structure:
 *
 *   1. A single shared queue (`automation-builtin-triggers`) accepts
 *      every recurring tick. A consumer registered at plugin init reads
 *      the payload's `jobId` and dispatches to whichever fire-callback
 *      was registered for that jobId.
 *   2. `setup()` is invoked once per (automation, trigger-config) pair
 *      by the standard trigger-subscriber machinery. It registers a
 *      fire-callback in a module-scoped map and calls
 *      `queue.scheduleRecurring(...)`; the matching teardown cancels
 *      the recurring job and drops the map entry.
 *
 * Restart semantics work the same way regardless of the queue
 * backend: `setupTriggerSubscriptions` re-runs every enabled
 * automation's `setup()` during `afterPluginsReady` on every boot,
 * and `setup()` calls `scheduleRecurring(...)` with a deterministic
 * jobId. On a persistent queue (BullMQ/Redis), the second call is an
 * in-place update of the surviving recurring job. On the in-memory
 * queue — whose recurring-schedule map gets wiped at shutdown — it
 * re-creates the schedule from scratch. Either way the schedule is
 * back in place by the time the consumer would dispatch.
 */
import { z } from "zod";
import type { Logger } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type { PluginMetadata } from "@checkstack/common";
import {
  evaluateBoolean,
  parseCondition,
} from "@checkstack/template-engine";

import type { TriggerDefinition } from "./action-types";

// ─── Shared queue plumbing ─────────────────────────────────────────────

export const BUILTIN_TRIGGER_QUEUE = "automation-builtin-triggers";
const BUILTIN_TRIGGER_CONSUMER_GROUP = "automation-builtin-triggers-worker";

export interface BuiltinTriggerTickPayload {
  /**
   * Stable identifier matching the recurring `jobId` so the consumer
   * can route the tick to the right fire-callback.
   */
  jobId: string;
}

/**
 * Module-scoped registry of `jobId` → tick handler. Populated by
 * `setup()` on automation start, drained by the teardown returned
 * from `setup()` on disable/delete.
 *
 * Scoped here (not under a `Map` in init's closure) so the queue
 * consumer registered in init can look up the live entries.
 */
const tickHandlers = new Map<string, (logger: Logger) => Promise<void>>();

export async function registerBuiltinTriggerConsumer(args: {
  queueManager: QueueManager;
  logger: Logger;
}): Promise<void> {
  const { queueManager, logger } = args;
  const queue = queueManager.getQueue<BuiltinTriggerTickPayload>(
    BUILTIN_TRIGGER_QUEUE,
  );
  await queue.consume(
    async (job) => {
      const handler = tickHandlers.get(job.data.jobId);
      if (!handler) {
        // Schedule may have outlived the trigger's setup — could
        // happen across a restart while jobs flush. Logging is
        // enough; the consumer keeps going.
        logger.debug(
          `Built-in trigger tick for ${job.data.jobId} has no registered handler — skipping`,
        );
        return;
      }
      await handler(logger);
    },
    {
      consumerGroup: BUILTIN_TRIGGER_CONSUMER_GROUP,
      // Time / template ticks are idempotent in spirit but a missed
      // fire is preferable to a duplicate fire (operators wire
      // mutation actions on these). Don't retry.
      maxRetries: 0,
    },
  );
}

function buildJobId(args: {
  kind: "cron" | "interval" | "template";
  automationId: string;
  triggerId: string;
}): string {
  return `builtin:${args.kind}:${args.automationId}:${args.triggerId}`;
}

// ─── time.cron ─────────────────────────────────────────────────────────

const cronConfigSchema = z.object({
  cronPattern: z
    .string()
    .min(1)
    .describe("Cron expression — fires on each match (e.g. `*/5 * * * *`)"),
});

const timeTickPayloadSchema = z.object({
  firedAt: z.string().describe("ISO timestamp of when the tick fired"),
});

export type TimeCronConfig = z.infer<typeof cronConfigSchema>;
export type TimeTickPayload = z.infer<typeof timeTickPayloadSchema>;

export interface BuiltinTriggerDeps {
  queueManager: QueueManager;
}

export function createTimeCronTrigger(
  deps: BuiltinTriggerDeps,
): TriggerDefinition<TimeTickPayload, TimeCronConfig> {
  return {
    id: "cron",
    displayName: "Cron Schedule",
    description:
      "Fires on a recurring cron pattern. Use for daily reports, periodic reconciliation, etc.",
    category: "Time",
    icon: "Clock",
    payloadSchema: timeTickPayloadSchema,
    configSchema: cronConfigSchema,
    setup: async ({ config, identity, fire, logger }) => {
      const jobId = buildJobId({
        kind: "cron",
        automationId: identity.automationId,
        triggerId: identity.triggerId,
      });
      tickHandlers.set(jobId, async () => {
        await fire({ firedAt: new Date().toISOString() });
      });
      const queue = deps.queueManager.getQueue<BuiltinTriggerTickPayload>(
        BUILTIN_TRIGGER_QUEUE,
      );
      await queue.scheduleRecurring(
        { jobId },
        { jobId, cronPattern: config.cronPattern },
      );
      logger.debug(
        `Scheduled time.cron trigger for automation ${identity.automationId}: ${config.cronPattern}`,
      );
      return async () => {
        tickHandlers.delete(jobId);
        await queue.cancelRecurring(jobId);
      };
    },
  };
}

// ─── time.interval ─────────────────────────────────────────────────────

const intervalConfigSchema = z.object({
  intervalSeconds: z
    .number()
    .int()
    .min(1)
    .max(31_536_000)
    .describe("Interval between fires, in seconds (1s – 1y)"),
});

export type TimeIntervalConfig = z.infer<typeof intervalConfigSchema>;

export function createTimeIntervalTrigger(
  deps: BuiltinTriggerDeps,
): TriggerDefinition<TimeTickPayload, TimeIntervalConfig> {
  return {
    id: "interval",
    displayName: "Interval",
    description: "Fires on a fixed time interval (seconds).",
    category: "Time",
    icon: "Timer",
    payloadSchema: timeTickPayloadSchema,
    configSchema: intervalConfigSchema,
    setup: async ({ config, identity, fire, logger }) => {
      const jobId = buildJobId({
        kind: "interval",
        automationId: identity.automationId,
        triggerId: identity.triggerId,
      });
      tickHandlers.set(jobId, async () => {
        await fire({ firedAt: new Date().toISOString() });
      });
      const queue = deps.queueManager.getQueue<BuiltinTriggerTickPayload>(
        BUILTIN_TRIGGER_QUEUE,
      );
      await queue.scheduleRecurring(
        { jobId },
        {
          jobId,
          intervalSeconds: config.intervalSeconds,
          // Delay the first fire by the interval so an operator doesn't
          // see a tick the instant they save the automation.
          startDelay: config.intervalSeconds,
        },
      );
      logger.debug(
        `Scheduled time.interval trigger for automation ${identity.automationId}: every ${config.intervalSeconds}s`,
      );
      return async () => {
        tickHandlers.delete(jobId);
        await queue.cancelRecurring(jobId);
      };
    },
  };
}

// ─── template ──────────────────────────────────────────────────────────

const templateConfigSchema = z.object({
  /**
   * Boolean expression evaluated every tick — uses the template
   * engine's condition grammar.
   *
   * The trigger context exposes `{ now }` (ISO string). Anything more
   * elaborate should be reached via the standard automation `variables`
   * block / action pipeline, not from the trigger itself — the
   * tick frequency makes anything I/O-heavy in here costly.
   */
  value_template: z
    .string()
    .min(1)
    .describe(
      "Boolean template — fires on the false → true edge. Has access to `{ now }`.",
    ),
  intervalSeconds: z
    .number()
    .int()
    .min(1)
    .max(86_400)
    .describe("How often to re-evaluate the template (1s – 24h)."),
});

const templateFiredPayloadSchema = z.object({
  firedAt: z.string(),
});

export type TemplateConfig = z.infer<typeof templateConfigSchema>;
export type TemplateFiredPayload = z.infer<typeof templateFiredPayloadSchema>;

export function createTemplateTrigger(
  deps: BuiltinTriggerDeps,
): TriggerDefinition<TemplateFiredPayload, TemplateConfig> {
  return {
    id: "template",
    displayName: "Template Condition",
    description:
      "Polls a boolean template on a fixed interval. Fires on the false → true edge so the automation runs once per truthy window, not on every tick.",
    category: "Time",
    icon: "FileCode",
    payloadSchema: templateFiredPayloadSchema,
    configSchema: templateConfigSchema,
    setup: async ({ config, identity, fire, logger }) => {
      const jobId = buildJobId({
        kind: "template",
        automationId: identity.automationId,
        triggerId: identity.triggerId,
      });
      // Each tick lives in this closure — `previousTruthy` survives
      // across ticks for the lifetime of the setup() return. Tearing
      // down resets it via the map-removal.
      let previousTruthy = false;
      let parsed;
      try {
        parsed = parseCondition(config.value_template);
      } catch (error) {
        // A malformed expression should fail fast at setup so the
        // operator sees the error in the editor rather than as
        // silently-never-firing.
        throw new Error(
          `template trigger: invalid value_template — ${(error as Error).message}`,
        );
      }
      tickHandlers.set(jobId, async (tickLogger) => {
        const truthy = (() => {
          try {
            return evaluateBoolean(parsed!, { now: new Date().toISOString() });
          } catch (error) {
            tickLogger.warn(
              `template trigger ${jobId} threw on evaluation — treating as false: ${(error as Error).message}`,
            );
            return false;
          }
        })();
        if (truthy && !previousTruthy) {
          await fire({ firedAt: new Date().toISOString() });
        }
        previousTruthy = truthy;
      });
      const queue = deps.queueManager.getQueue<BuiltinTriggerTickPayload>(
        BUILTIN_TRIGGER_QUEUE,
      );
      await queue.scheduleRecurring(
        { jobId },
        {
          jobId,
          intervalSeconds: config.intervalSeconds,
          startDelay: config.intervalSeconds,
        },
      );
      logger.debug(
        `Scheduled template trigger for automation ${identity.automationId}: every ${config.intervalSeconds}s`,
      );
      return async () => {
        tickHandlers.delete(jobId);
        await queue.cancelRecurring(jobId);
      };
    },
  };
}

// ─── Public registry helper ────────────────────────────────────────────

/**
 * Construct all three built-in triggers and register them through the
 * provided callback (which the automation-backend init phase passes
 * straight into the trigger registry).
 */
export function registerBuiltinTriggers(args: {
  queueManager: QueueManager;
  pluginMetadata: PluginMetadata;
  registerTrigger: (
    trigger: TriggerDefinition<unknown, unknown>,
    metadata: PluginMetadata,
  ) => void;
}): void {
  const deps: BuiltinTriggerDeps = { queueManager: args.queueManager };
  args.registerTrigger(
    createTimeCronTrigger(deps) as unknown as TriggerDefinition<unknown, unknown>,
    args.pluginMetadata,
  );
  args.registerTrigger(
    createTimeIntervalTrigger(deps) as unknown as TriggerDefinition<unknown, unknown>,
    args.pluginMetadata,
  );
  args.registerTrigger(
    createTemplateTrigger(deps) as unknown as TriggerDefinition<unknown, unknown>,
    args.pluginMetadata,
  );
}

/**
 * Test-only helper — exported so the test file can verify the
 * module-scoped map is empty between test cases.
 */
export function _resetBuiltinTriggerTickHandlersForTests(): void {
  tickHandlers.clear();
}
