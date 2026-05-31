/**
 * The reactive `slo` entity (reactive automation engine §10.7, §9.2).
 *
 * Model B PLUGIN-BACKED + COMPUTED entity. There is NO framework
 * `entity_state` row for an SLO. The current state is assembled on demand by
 * the `read` accessor from two sources:
 *
 *   - `slo_streaks` + `slo_objectives` (authoritative tables) supply
 *     `currentStreak` / `bestStreak` / `systemId` / `target`, and
 *   - the SLO engine COMPUTES `budgetRemainingPercent` (and re-surfaces
 *     `target`) on the fly via `computeStatus` (downtime aggregation over the
 *     objective's window).
 *
 * The streak-persist site (the daily snapshot job) drives its write through
 * `handle.mutate({ id: objectiveId, apply })`: `apply` persists the streak to
 * `slo_streaks` (the plugin's own write) and returns the freshly-computed
 * view. The framework snapshots `prev` via `read` BEFORE the write, appends
 * the transition log, and emits `ENTITY_CHANGED`.
 *
 * Per §9.2 the SLO budget IS the entity, and the four removed threshold hooks
 * (`budget.warning/critical/exhausted`, `streak.broken`) become derived
 * `numeric_state` / `state` conditions over
 * `state.slo.<objectiveId>.budgetRemainingPercent` + `currentStreak`. The
 * change deriver therefore emits NO legacy trigger events — operators author
 * thresholds as reactive conditions, not pre-baked event triggers.
 */
import { z } from "zod";
import type {
  EntityChangeDeriver,
  EntityHandle,
  EntityMutationOpts,
  EntityRead,
} from "@checkstack/automation-backend";

import type { SloService } from "./service";
import type { SloEngine } from "./slo-engine";

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

/**
 * Compute the reactive `slo` view for a single objective: read the objective
 * config + streak, compute the error-budget remaining via the engine, and
 * assemble the `{ objectiveId, systemId, target, budgetRemainingPercent,
 * currentStreak, bestStreak }` subset. Returns `undefined` when the objective
 * no longer exists (missing ids are omitted from the batched `read`).
 *
 * Compute-on-read (not materialized): the budget is a pure function of the
 * objective's append-only downtime history over its rolling window. Storing a
 * second copy would duplicate the engine's source of truth and risk drift; a
 * read recomputes from the same tables the API already reads. See the change
 * doc for the cost assessment.
 */
export async function computeSloEntityState(args: {
  service: SloService;
  engine: SloEngine;
  objectiveId: string;
}): Promise<SloEntityState | undefined> {
  const { service, engine, objectiveId } = args;
  const objective = await service.getObjective({ id: objectiveId });
  if (!objective) return undefined;

  const [status, streak] = await Promise.all([
    engine.computeStatus({ objective }),
    service.getStreak({ objectiveId }),
  ]);

  return {
    objectiveId,
    systemId: objective.systemId,
    target: objective.target,
    budgetRemainingPercent: status.errorBudgetRemainingPercent,
    currentStreak: streak?.currentStreak ?? 0,
    bestStreak: streak?.bestStreak ?? 0,
  };
}

/**
 * Build the PLUGIN-BACKED + COMPUTED `read` accessor for the `slo` entity.
 * For each objective id, assembles the view via {@link computeSloEntityState}
 * (missing objectives omitted). This is the single source of truth that
 * `handle.mutate` snapshots `prev` from and `get`/`getMany`/scope enrichment
 * route through — no framework `entity_state` storage.
 */
export function createSloEntityRead(deps: {
  service: SloService;
  engine: SloEngine;
}): EntityRead<SloEntityState> {
  const { service, engine } = deps;
  return async (ids) => {
    if (ids.length === 0) return {};
    const out: Record<string, SloEntityState> = {};
    await Promise.all(
      ids.map(async (objectiveId) => {
        const state = await computeSloEntityState({
          service,
          engine,
          objectiveId,
        });
        if (state) out[objectiveId] = state;
      }),
    );
    return out;
  };
}

/**
 * Drive the streak-persist write through `handle.mutate` (§10.7). `apply`
 * performs the REAL `slo_streaks` write (the plugin's own db/tx) and returns
 * the freshly-computed `slo` view (budget recomputed + post-write streak).
 * The framework snapshots `prev` via `read` BEFORE the write, appends the
 * transition log, and emits `ENTITY_CHANGED`. No-op (no emit) when the
 * recomputed view is structurally equal to `prev`.
 *
 * When no handle is available (tests / before wiring), the write still runs
 * — the entity reactivity is layered on top, never required for the streak
 * write to succeed. Errors from the entity layer are routed to `onError` so a
 * mirror/transition failure never breaks the daily job.
 */
export async function writeSloEntity(args: {
  handle: EntityHandle<SloEntityState> | undefined;
  objectiveId: string;
  opts?: EntityMutationOpts;
  apply: () => Promise<SloEntityState>;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { handle, objectiveId, opts, apply, onError } = args;
  if (!handle) {
    await apply();
    return;
  }
  try {
    await handle.mutate({ id: objectiveId, opts, apply });
  } catch (error) {
    onError?.(error);
  }
}
