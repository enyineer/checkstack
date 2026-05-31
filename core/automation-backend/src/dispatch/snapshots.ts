/**
 * Validation for snapshots that were written to jsonb columns and are read
 * back later (dwell `actorSnapshot`, wait-lock `waitConfig`).
 *
 * These columns are typed `unknown`/`Record<string, unknown>` at the DB
 * boundary, so the engine previously trusted them via `as unknown as ...`
 * casts on LOAD. A drifted schema or a hand-edited row would then flow
 * through as the wrong type and blow up far from the cause. We instead
 * `safeParse` on load and degrade safely (the write side stays as-is — it
 * writes known-good typed data).
 */
import { z } from "zod";
import { type Actor, ActorSchema, SYSTEM_ACTOR } from "@checkstack/common";
import { ConditionSchema } from "@checkstack/automation-common";
import type { Logger } from "@checkstack/backend-api";

import type { UntilWaitConfig } from "./types";

/**
 * Stored config for a `kind: "until"` wait lock (jsonb).
 *
 * NOTE: this is a non-strict `z.object`, so old persisted rows that still
 * carry a `pollSeconds` key (written before the reactive engine dropped
 * polling) parse cleanly — zod silently strips the unknown key. Do NOT make
 * this `.strict()` or resuming an already-suspended wait would fail.
 */
export const UntilWaitConfigSchema: z.ZodType<UntilWaitConfig> = z.object({
  condition: ConditionSchema,
  continueOnTimeout: z.boolean(),
});

/**
 * Parse a stored `actorSnapshot`. Degrades to {@link SYSTEM_ACTOR} on a
 * malformed/drifted row rather than crashing the fire — actor is used for
 * attribution, and dropping a legitimate alert because of a bad snapshot is
 * worse than attributing it to the system. Logs a warning so the drift is
 * visible.
 */
export function parseActorSnapshot({
  value,
  logger,
  context,
}: {
  value: unknown;
  logger?: Logger;
  context: string;
}): Actor {
  const result = ActorSchema.safeParse(value);
  if (result.success) return result.data;
  logger?.warn(
    `${context}: stored actorSnapshot is malformed (${result.error.message}); ` +
      `falling back to the system actor`,
  );
  return SYSTEM_ACTOR;
}

/**
 * Parse a stored wait-lock `waitConfig`. Returns `null` (which the engine
 * treats as a gone/invalid `until` lock and fails the run cleanly) on a
 * malformed/drifted row, rather than trusting wrongly-typed data downstream.
 */
export function parseWaitConfig({
  value,
  logger,
  context,
}: {
  value: unknown;
  logger?: Logger;
  context: string;
}): UntilWaitConfig | null {
  if (value === null || value === undefined) return null;
  const result = UntilWaitConfigSchema.safeParse(value);
  if (result.success) return result.data;
  logger?.warn(
    `${context}: stored waitConfig is malformed (${result.error.message}); ` +
      `treating the wait lock as invalid`,
  );
  return null;
}
