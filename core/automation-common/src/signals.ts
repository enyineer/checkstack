import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";
import { RunStatusSchema, StepStatusSchema } from "./schemas";

/**
 * Fired when an automation definition is created, updated, or deleted.
 * Frontends use this to invalidate caches.
 */
export const AUTOMATION_DEFINITION_CHANGED = createSignal({
  pluginMetadata,
  event: "automation_definition_changed",
  payloadSchema: z.object({
    action: z.enum(["created", "updated", "deleted"]),
    automationId: z.string(),
  }),
});

/**
 * Fired when an automation run starts.
 */
export const AUTOMATION_RUN_STARTED = createSignal({
  pluginMetadata,
  event: "automation_run_started",
  payloadSchema: z.object({
    runId: z.string(),
    automationId: z.string(),
    triggerId: z.string(),
  }),
});

/**
 * Fired when a run transitions to a terminal state.
 */
export const AUTOMATION_RUN_COMPLETED = createSignal({
  pluginMetadata,
  event: "automation_run_completed",
  payloadSchema: z.object({
    runId: z.string(),
    automationId: z.string(),
    status: RunStatusSchema,
    errorMessage: z.string().optional(),
  }),
});

/**
 * Fired when a single action step completes — useful for the run-detail
 * page to refresh step status live.
 */
export const AUTOMATION_RUN_STEP_COMPLETED = createSignal({
  pluginMetadata,
  event: "automation_run_step_completed",
  payloadSchema: z.object({
    runId: z.string(),
    stepId: z.string(),
    status: StepStatusSchema,
  }),
});
