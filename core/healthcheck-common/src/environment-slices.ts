/**
 * Pure helpers for deciding which per-environment run slices currently
 * CONTRIBUTE to a (system, config) assignment's aggregate/rollup, given the
 * assignment's `environmentIds` selector.
 *
 * This lives in `*-common` because BOTH the backend rollup aggregation
 * (`getSystemHealthStatus` / `getSystemHealthOverview`) and the frontend
 * overview orphan detection must agree, byte-for-byte, on when a slice is
 * "effective" vs "orphaned". Deriving it in one place stops the two from
 * drifting.
 *
 * The rules mirror the backend's `resolveEffectiveEnvironments`:
 * - `environmentIds === null | undefined` => ALL current environments.
 * - `environmentIds === []`                => OPT OUT (env-less run only).
 * - non-empty `environmentIds`             => exactly those ids.
 *
 * Everything here is derived from durable Postgres state
 * (`systemHealthChecks.environmentIds` + which env ids actually have runs), so
 * it returns the SAME answer on every pod without a catalog read - which is why
 * the backend can use it on the compute-on-read `health` entity path (whose
 * service has no catalog client).
 */

/**
 * A per-assignment environment selector. `null`/`undefined` = all current
 * environments; `[]` = opt out (env-less only); a non-empty array = exactly
 * those environment ids.
 */
export type EnvironmentSelector = string[] | null | undefined;

/**
 * Does the assignment's environment selector currently include this CONCRETE
 * environment id? `null`/`undefined` (all) includes every environment; `[]`
 * (opt-out) includes none; an explicit list includes only its members.
 *
 * NOTE: this answers the SELECTOR question only. It does NOT consult catalog
 * membership, so an id the selector includes may still have been removed from
 * the system entirely; callers with membership in hand should AND that in.
 */
export function selectorIncludesEnvironment({
  environmentIds,
  environmentId,
}: {
  environmentIds: EnvironmentSelector;
  environmentId: string;
}): boolean {
  if (environmentIds === null || environmentIds === undefined) return true;
  if (environmentIds.length === 0) return false;
  return environmentIds.includes(environmentId);
}

/**
 * Whether a per-environment run slice currently CONTRIBUTES to the assignment's
 * aggregate/rollup.
 *
 * A slice is EFFECTIVE when the assignment currently fans out to it; it is
 * ORPHANED (must be excluded from the rollup, and tucked under "Old checks" in
 * the overview) when:
 * - its environment was disabled/removed from the assignment's selector, or
 * - it is the env-less (`null`) slice of a check that now fans out to at least
 *   one selected environment.
 *
 * `hasLiveSelectedEnvSlice` disambiguates the env-less slice: it is `true` when
 * the check currently has at least one concrete environment slice the selector
 * still includes (compute it with {@link selectorIncludesEnvironment} over the
 * env ids that actually have runs). When the check does NOT currently fan out
 * to any selected environment, the env-less slice is the live one.
 */
export function isEnvSliceEffective({
  environmentId,
  environmentIds,
  hasLiveSelectedEnvSlice,
}: {
  environmentId: string | null;
  environmentIds: EnvironmentSelector;
  hasLiveSelectedEnvSlice: boolean;
}): boolean {
  if (environmentId === null) {
    return !hasLiveSelectedEnvSlice;
  }
  return selectorIncludesEnvironment({ environmentIds, environmentId });
}

/**
 * Given an assignment's `environmentIds` selector and the DISTINCT environment
 * keys that actually have runs (`null` = the env-less slice), return the subset
 * of keys that are currently EFFECTIVE (contribute to the rollup). Encapsulates
 * the `hasLiveSelectedEnvSlice` bookkeeping so callers iterating grouped runs
 * don't each re-derive it.
 */
export function selectEffectiveEnvKeys({
  environmentIds,
  presentEnvKeys,
}: {
  environmentIds: EnvironmentSelector;
  presentEnvKeys: Iterable<string | null>;
}): Set<string | null> {
  const keys = [...presentEnvKeys];
  const hasLiveSelectedEnvSlice = keys.some(
    (key): key is string =>
      key !== null &&
      selectorIncludesEnvironment({ environmentIds, environmentId: key }),
  );
  const effective = new Set<string | null>();
  for (const key of keys) {
    if (
      isEnvSliceEffective({
        environmentId: key,
        environmentIds,
        hasLiveSelectedEnvSlice,
      })
    ) {
      effective.add(key);
    }
  }
  return effective;
}
