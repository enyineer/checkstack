/**
 * Built-in triggers shipped by automation-backend itself.
 *
 * Two setup-backed triggers (no plugin hook to subscribe to):
 *
 *   - `time.cron` — recurring queue job on a cron pattern.
 *   - `time.interval` — recurring queue job on a fixed interval.
 *
 * (The polling `template` trigger was removed in the reactive engine —
 * §7. Its real cases are covered reactively by the `numeric_state` /
 * `state` triggers + conditions, which wake on `ENTITY_CHANGED` instead of
 * re-evaluating on a timer.)
 *
 * Both share the same two-stage runtime structure:
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
import { createHook, type Logger } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type { PluginMetadata } from "@checkstack/common";

import type { TriggerDefinition } from "./action-types";
import { extractNumericField, matchesThreshold } from "./dispatch/numeric";

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
  kind: "cron" | "interval";
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

// ─── numeric_state ───────────────────────────────────────────────────────

/**
 * The `healthcheck.check.completed` hook this trigger rides. Referenced
 * by id only (a `Hook` is just `{ id }`), so automation-backend needs no
 * compile-time dependency on healthcheck-backend — the id must match what
 * healthcheck emits.
 */
const HEALTHCHECK_CHECK_COMPLETED = "healthcheck.check.completed";

interface CheckCompletedPayload {
  systemId: string;
  configurationId: string;
  status: string;
  latencyMs?: number;
  result?: Record<string, unknown>;
  timestamp?: string;
}

const numericStateConfigSchema = z
  .object({
    field: z
      .string()
      .min(1)
      .describe(
        "Numeric field to watch: `latencyMs`, `p95LatencyMs`, or a collector path like `collectors.http.responseTimeMs`.",
      ),
    above: z
      .number()
      .optional()
      .describe("Fire when the field is strictly greater than this."),
    below: z
      .number()
      .optional()
      .describe("Fire when the field is strictly less than this."),
  })
  .refine((c) => c.above !== undefined || c.below !== undefined, {
    message: "numeric_state trigger requires at least one of `above` / `below`",
  });

export type NumericStateConfig = z.infer<typeof numericStateConfigSchema>;

const numericStatePayloadSchema = z.object({
  systemId: z.string(),
  configurationId: z.string(),
  status: z.string(),
  field: z.string().describe("The watched field path."),
  value: z.number().describe("The numeric value that crossed the threshold."),
  timestamp: z.string().optional(),
});

export type NumericStatePayload = z.infer<typeof numericStatePayloadSchema>;

/**
 * `numeric_state` — fires off `healthcheck.check.completed` when a numeric
 * field crosses an `above` / `below` threshold. Hook-backed; the per-
 * automation threshold is enforced via `evaluateConfig` (a structured gate
 * the trigger fan-in calls before starting a run). Combine with a
 * trigger-level `for:` (Phase 15) for "above X for Y minutes".
 *
 * v1 is LEVEL-triggered: it fires on every completed check whose field is
 * past the threshold. Edge (false → true) de-duplication is deferred;
 * `mode: single` + `for:` already prevent alert storms in practice.
 */
export function createNumericStateTrigger(): TriggerDefinition<
  NumericStatePayload,
  NumericStateConfig
> {
  return {
    id: "numeric_state",
    displayName: "Numeric Threshold",
    description:
      "Fires when a health-check numeric field (latency, p95, a collector metric) crosses an above/below threshold. Pair with `for:` for sustained thresholds.",
    category: "Health",
    icon: "Gauge",
    payloadSchema: numericStatePayloadSchema,
    configSchema: numericStateConfigSchema,
    // Rides the healthcheck check-completed hook; the threshold gate below
    // decides whether a given completion fires this automation.
    hook: createHook<NumericStatePayload>(HEALTHCHECK_CHECK_COMPLETED),
    contextKey: (payload) => payload.systemId,
    contextKeyLabel: "system",
    evaluateConfig: (payload, config) => {
      // The hook delivers the raw `healthcheck.check.completed` payload
      // (latencyMs top-level, `result` = collectors map). extractNumericField
      // knows that shape.
      const raw = payload as unknown as CheckCompletedPayload;
      const value = extractNumericField(
        raw as unknown as Record<string, unknown>,
        config.field,
      );
      return matchesThreshold({
        value,
        above: config.above,
        below: config.below,
      });
    },
  };
}

// ─── Public registry helper ────────────────────────────────────────────

/**
 * Construct the built-in triggers and register them through the provided
 * callback (which the automation-backend init phase passes straight into
 * the trigger registry).
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
    createNumericStateTrigger() as unknown as TriggerDefinition<
      unknown,
      unknown
    >,
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
