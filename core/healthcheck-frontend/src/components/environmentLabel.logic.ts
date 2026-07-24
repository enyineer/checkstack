import type { EnvironmentLabel } from "./HealthCheckRunsTable";

/**
 * How a run row should present its environment.
 *
 * The three cases were previously conflated into "name, or else the words
 * Removed environment", which is why a page that simply forgot to supply the
 * label list labelled every LIVE environment as removed: with no list, "not
 * found" and "does not exist" are indistinguishable.
 *
 * They are separated here so the distinction is explicit and testable:
 * - `none`    - the run is env-less (no environment in context).
 * - `named`   - the environment exists; show its name.
 * - `removed` - the id is genuinely absent from the FULL environment list, so
 *   the environment was deleted from the catalog.
 */
export type RunEnvironmentLabel =
  | { kind: "none" }
  | { kind: "named"; name: string }
  | { kind: "removed" };

/**
 * Resolve a run's environment against the full list of environments in the
 * instance (see `useEnvironmentLabels`), NOT just those currently assigned to a
 * system - a run recorded for an environment that was later unassigned should
 * still show its name.
 *
 * `environmentLabels` must be that full list. Callers hold their rows until it
 * has loaded, so a still-loading list never renders as `removed`.
 */
export function resolveRunEnvironmentLabel({
  environmentId,
  environmentLabels,
}: {
  environmentId: string | null | undefined;
  environmentLabels: readonly EnvironmentLabel[];
}): RunEnvironmentLabel {
  if (!environmentId) return { kind: "none" };
  const name = environmentLabels.find((e) => e.id === environmentId)?.name;
  return name === undefined ? { kind: "removed" } : { kind: "named", name };
}
