/**
 * Observed-service-name suggestions for the system-link editor come from metric
 * LABEL VALUES, not raw events (metricstream stores aggregates, not rows). The
 * `service.name` / `service_name` resource attribute rides on a metric's series
 * labels, so the two conventional keys are sampled and merged here.
 *
 * `listLabelValues` is scoped to a single (metric, key) pair, so the hook that
 * calls this samples the highest-cardinality metric (most likely to carry the
 * resource attribute across services) as a bounded, best-effort probe -
 * suggestions are non-authoritative (a human clicks a chip to link a system).
 */

/** The two conventional label keys a service name is published under. */
export const SERVICE_NAME_LABEL_KEYS = ["service.name", "service_name"] as const;

/**
 * Merge label-value lists from the sampled service-name keys into one distinct,
 * trimmed, empty-stripped, stably-ordered set. Tolerates any list being
 * missing/empty (a stream may publish neither key).
 */
export function mergeServiceNames(
  ...lists: ReadonlyArray<readonly string[] | undefined>
): string[] {
  const set = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const raw of list) {
      const trimmed = raw.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return [...set].toSorted((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}
