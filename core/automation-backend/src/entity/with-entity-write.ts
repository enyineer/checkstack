/**
 * Shared driven-write/remove guard for PLUGIN-BACKED (Model B) entities.
 *
 * Every plugin-backed domain (incident, catalog, dependency, maintenance, slo,
 * satellite) drives its reactive-state writes through the same tiny guard:
 *
 *   - no handle wired (tests construct the router without one, or before the
 *     entity is defined) → run the plugin write (`apply`) directly; reactivity
 *     is layered on top and is never required for the underlying write to
 *     succeed, and
 *   - handle wired → route through `handle.mutate` / `handle.remove` so the
 *     framework snapshots `prev`, appends the transition log, and emits
 *     `ENTITY_CHANGED`.
 *
 * The only thing that varied between the per-domain copies was the id-key name
 * (`incidentId`, `dependencyId`, …); the guard itself is identical. Domains
 * keep their thin, well-named wrappers (`writeIncidentEntity`, …) but delegate
 * the guard here so the branch lives in exactly one place.
 *
 * NOTE: `writeHealthEntity` (healthcheck-backend) is deliberately NOT built on
 * this helper — it is genuinely bespoke (closure-captured durable state,
 * distinct rethrow-vs-fail-soft branches, a per-system serializer, and it
 * returns the computed state). Do not force-fit it here.
 */
import type { EntityHandle, EntityMutationOpts } from "./define-entity";

/**
 * Drive a reactive-state write through `handle.mutate`, falling back to a plain
 * `apply()` when no handle is wired. `apply` performs the plugin's REAL write
 * (its own db/tx) and returns the new reactive state; the framework snapshots
 * `prev`, appends the transition log, and emits `ENTITY_CHANGED`.
 */
export async function withEntityWrite<
  TState extends Record<string, unknown>,
>(args: {
  handle: EntityHandle<TState> | undefined;
  id: string;
  opts?: EntityMutationOpts;
  apply: () => Promise<TState>;
}): Promise<void> {
  const { handle, id, opts, apply } = args;
  if (!handle) {
    await apply();
    return;
  }
  await handle.mutate({ id, opts, apply });
}

/**
 * Drive a tombstone through `handle.remove`, falling back to a plain `apply()`
 * when no handle is wired. `apply` performs the plugin's REAL delete (its own
 * db/tx); the framework records the tombstone transition and emits a tombstone
 * `ENTITY_CHANGED`.
 */
export async function withEntityRemove<
  TState extends Record<string, unknown>,
>(args: {
  handle: EntityHandle<TState> | undefined;
  id: string;
  opts?: EntityMutationOpts;
  apply: () => Promise<void>;
}): Promise<void> {
  const { handle, id, opts, apply } = args;
  if (!handle) {
    await apply();
    return;
  }
  await handle.remove({ id, opts, apply });
}
