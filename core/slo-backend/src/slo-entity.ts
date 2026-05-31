/**
 * The reactive `slo` entity (reactive automation engine §10.7, §9.2).
 *
 * Behavior-preserving MIRROR: the `slo_objectives` / `slo_streaks` tables +
 * the engine's computed budget stay authoritative; the recompute site
 * mirrors the reactive subset `{ objectiveId, systemId, target,
 * budgetRemainingPercent, currentStreak, bestStreak }` into the framework
 * entity store keyed by `objectiveId`.
 *
 * Per §9.2 the SLO budget IS the entity, and the four removed threshold
 * hooks (`budget.warning/critical/exhausted`, `streak.broken`) become
 * derived `numeric_state` / `state` conditions over
 * `state.slo.<objectiveId>.budgetRemainingPercent` + `currentStreak`. The
 * change deriver therefore emits NO legacy trigger events — operators
 * author thresholds as reactive conditions, not pre-baked event triggers.
 */
import { z } from "zod";
import type {
  EntityChangeDeriver,
  EntityHandle,
} from "@checkstack/automation-backend";

export const SLO_ENTITY_KIND = "slo";

export const SloEntityStateSchema = z.object({
  objectiveId: z.string(),
  systemId: z.string(),
  target: z.number(),
  budgetRemainingPercent: z.number(),
  currentStreak: z.number().int().nonnegative(),
  bestStreak: z.number().int().nonnegative(),
});

export type SloEntityState = z.infer<typeof SloEntityStateSchema>;

/**
 * SLO change → trigger events. Intentionally empty: the threshold/streak
 * hooks were removed (§9.2) and replaced by `numeric_state` / `state`
 * conditions over the entity state, so a change fires no legacy event. The
 * deriver is still registered so the kind is a known reactive kind (its
 * state is resolvable into automation scope for those conditions + wakes
 * suspended `wait_until`s whose condition reads `state.slo.*`).
 */
export const deriveSloTriggerEvents: EntityChangeDeriver = () => [];

/** Mirror an SLO objective's budget + streak into the `slo` entity (fail-soft). */
export async function mirrorSloEntity(args: {
  handle: EntityHandle<SloEntityState> | undefined;
  objectiveId: string;
  systemId: string;
  target: number;
  budgetRemainingPercent: number;
  currentStreak: number;
  bestStreak: number;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const {
    handle,
    objectiveId,
    systemId,
    target,
    budgetRemainingPercent,
    currentStreak,
    bestStreak,
    onError,
  } = args;
  if (!handle) return;
  try {
    await handle.set(objectiveId, {
      objectiveId,
      systemId,
      target,
      budgetRemainingPercent,
      currentStreak,
      bestStreak,
    });
  } catch (error) {
    onError?.(error);
  }
}
