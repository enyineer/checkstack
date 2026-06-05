import type { Environment } from "@checkstack/catalog-common";

/**
 * The resolved environment a single fanned-out run executes for. A subset of
 * the catalog `Environment` carrying only the run-relevant fields. `fields`
 * is the environment's free-form custom metadata (verbatim values) - it is
 * surfaced to collectors via `CollectorRunContext.environment.fields`
 * (metadata only, never secrets).
 */
export interface EffectiveEnvironment {
  id: string;
  name: string;
  fields: Record<string, unknown>;
}

/**
 * Resolve the effective set of environments a (config, system) assignment
 * fans out into for one tick.
 *
 * Semantics (locked, §2/§7.1 of the environments plan):
 * - `environmentIds === null` => ALL environments the system currently
 *   belongs to (the `membership` set).
 * - `environmentIds === []`   => OPT OUT: an empty result, meaning the check
 *   runs exactly ONCE with no environment in context (env-less run).
 * - non-empty `environmentIds` => exactly those ids, INTERSECTED with the
 *   current membership. An explicit id no longer in membership silently
 *   drops (consistent with stale-ref pruning in the GitOps groups reconcile).
 *
 * The caller turns an empty result into a single env-less run (so a fanned
 * check with no effective environments behaves exactly like the pre-feature
 * single run). A non-empty result drives one run per environment.
 *
 * Membership order is preserved so fan-out order is deterministic.
 */
export function resolveEffectiveEnvironments({
  environmentIds,
  membership,
}: {
  environmentIds: string[] | null | undefined;
  membership: Environment[];
}): EffectiveEnvironment[] {
  const toEffective = (env: Environment): EffectiveEnvironment => ({
    id: env.id,
    name: env.name,
    fields: env.metadata ?? {},
  });

  // null / undefined => all current environments.
  if (environmentIds === null || environmentIds === undefined) {
    return membership.map((env) => toEffective(env));
  }

  // [] => opt out (env-less single run).
  if (environmentIds.length === 0) {
    return [];
  }

  // Non-empty => explicit subset intersected with current membership,
  // preserving membership order; stale ids silently drop.
  const wanted = new Set(environmentIds);
  return membership
    .filter((env) => wanted.has(env.id))
    .map((env) => toEffective(env));
}
