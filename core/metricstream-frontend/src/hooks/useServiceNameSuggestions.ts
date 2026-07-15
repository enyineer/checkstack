import { useMemo } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { MetricstreamApi } from "@checkstack/metricstream-common";
import {
  SERVICE_NAME_LABEL_KEYS,
  mergeServiceNames,
} from "../lib/service-name-suggestions";

/** How many metric names to inspect when picking a representative to sample. */
const METRIC_SAMPLE_LIMIT = 50;
/** Distinct label values pulled per key (bounded; suggestions are best-effort). */
const LABEL_VALUE_LIMIT = 200;

/**
 * Observed `service.name` values for the system-link editor's suggestion chips.
 *
 * metricstream has no raw-row `service.name` scan (it stores aggregates), and
 * `listLabelValues` is scoped to ONE (metric, key) pair. So this samples the
 * stream's highest-cardinality metric - the one most likely to carry the
 * `service.name` / `service_name` resource attribute across every reporting
 * service - and merges the two conventional keys' distinct values. It is a
 * bounded, best-effort probe: suggestions are never auto-applied (a human clicks
 * a chip), so a heuristic sample is the right cost/coverage trade-off here.
 */
export function useServiceNameSuggestions(streamId: string): {
  serviceNames: string[];
  loading: boolean;
} {
  const client = usePluginClient(MetricstreamApi);

  const { data: namesData, isPending: namesLoading } =
    client.listMetricNames.useQuery(
      { streamId, limit: METRIC_SAMPLE_LIMIT },
      { staleTime: 60_000 },
    );

  // The highest-cardinality metric carries the widest label set, so it is the
  // best single-metric probe for resource attributes shared across services.
  const sampleMetric = useMemo(() => {
    const names = namesData?.names ?? [];
    const top = names.toSorted((a, b) => b.seriesCount - a.seriesCount)[0];
    return top?.name;
  }, [namesData]);

  const [dottedKey, underscoreKey] = SERVICE_NAME_LABEL_KEYS;
  const dottedQuery = client.listLabelValues.useQuery(
    { streamId, metricName: sampleMetric ?? "", key: dottedKey, limit: LABEL_VALUE_LIMIT },
    { enabled: !!sampleMetric, staleTime: 60_000 },
  );
  const underscoreQuery = client.listLabelValues.useQuery(
    { streamId, metricName: sampleMetric ?? "", key: underscoreKey, limit: LABEL_VALUE_LIMIT },
    { enabled: !!sampleMetric, staleTime: 60_000 },
  );

  const serviceNames = useMemo(
    () => mergeServiceNames(dottedQuery.data?.values, underscoreQuery.data?.values),
    [dottedQuery.data, underscoreQuery.data],
  );

  const loading =
    namesLoading ||
    (!!sampleMetric && (dottedQuery.isPending || underscoreQuery.isPending));

  return { serviceNames, loading };
}
