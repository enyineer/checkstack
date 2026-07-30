/**
 * What a satellite-only check should do when the core reaches its tick.
 *
 * ## The bug this exists to close
 *
 * A check with `includeLocal: false` and assigned satellites is executed BY
 * those satellites; the core's own tick has nothing to run and returned
 * immediately. If every assigned satellite is offline, nobody executes it - and
 * because the core recorded nothing at all, the check kept displaying whatever
 * status it last had, indefinitely. A dead probe was indistinguishable from a
 * passing one, which is the single worst failure mode a monitoring tool can
 * have.
 *
 * So the core now records a `degraded` run instead of staying silent.
 * `degraded` rather than `unhealthy` because the target may be perfectly
 * healthy - what failed is our ability to observe it. Marking it unhealthy
 * would raise incident-grade alarms about services that are fine, every time a
 * satellite host reboots.
 */
export type SatelliteOnlyOutcome =
  /** Satellites are executing this check; the core has nothing to do. */
  | "satellites-executing"
  /** No assigned satellite is online - record a stale run so the gap is visible. */
  | "record-unobservable";

export function resolveSatelliteOnlyOutcome({
  satelliteIds,
  onlineSatelliteIds,
}: {
  /** Satellites assigned to this check. */
  satelliteIds: readonly string[];
  /**
   * Currently-online satellite ids. `undefined` when liveness could not be
   * determined at all (no resolver wired, or the lookup failed).
   */
  onlineSatelliteIds?: readonly string[];
}): SatelliteOnlyOutcome {
  // Unknown liveness must NEVER manufacture a degraded run: a transient failure
  // to reach the satellite service would otherwise mark every satellite-only
  // check degraded across the fleet at once. Staying silent is the pre-existing
  // behaviour and the safe direction for an unknown.
  if (onlineSatelliteIds === undefined) return "satellites-executing";

  // An empty assignment set has nothing to be offline. `[].some()` is false, so
  // without this guard a check with no satellites would be reported as
  // unobservable - a degraded run for a configuration that cannot produce one.
  if (satelliteIds.length === 0) return "satellites-executing";

  const online = new Set(onlineSatelliteIds);
  const anyOnline = satelliteIds.some((id) => online.has(id));

  return anyOnline ? "satellites-executing" : "record-unobservable";
}

/** The result payload recorded for an unobservable run. */
export function buildUnobservableResult({
  satelliteIds,
}: {
  satelliteIds: readonly string[];
}): Record<string, unknown> {
  const count = satelliteIds.length;
  return {
    error:
      `No assigned satellite is online (${count} assigned), so this check could not be executed. ` +
      "The target's actual health is unknown - this is a monitoring gap, not a confirmed outage.",
    satelliteOffline: true,
    assignedSatelliteCount: count,
  };
}

/**
 * The `persistRunAndReact` arguments for an unobservable run.
 *
 * Extracted so the RECORDED VALUES - degraded, the payload's environment slice,
 * the local source label - are pinned by a test. The executor's mock database
 * cannot service `persistRunAndReact`'s insert/aggregate chain, so the only way
 * to assert what gets written is to make the decision about what to write a
 * separate, pure step.
 */
export function buildUnobservableRun({
  environmentId,
  satelliteIds,
}: {
  /** The single (config, system, env) slice this job owns. */
  environmentId: string | null;
  satelliteIds: readonly string[];
}): {
  status: "degraded";
  environmentId: string | null;
  sourceLabel: string;
  result: Record<string, unknown>;
} {
  return {
    // Degraded, NOT unhealthy: the target may be perfectly healthy and what
    // failed is our ability to observe it. Unhealthy would raise
    // incident-grade alarms about healthy services on every satellite reboot.
    status: "degraded",
    // The job payload already names the slice the satellites would have
    // reported for, so the gap lands exactly where the missing runs would have.
    environmentId,
    // Recorded by the CORE, which is what noticed the gap - not by a satellite,
    // which by definition reported nothing.
    sourceLabel: "Local",
    result: buildUnobservableResult({ satelliteIds }),
  };
}
