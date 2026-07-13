import type { OptionsResolver, ResolverOption } from "@checkstack/ui";
import type { ConfigOptionsResolverContext } from "@checkstack/healthcheck-frontend";
import {
  MetricstreamApi,
  METRICSTREAM_STREAM_OPTIONS_RESOLVER,
  METRICSTREAM_METRIC_NAME_OPTIONS_RESOLVER,
  METRICSTREAM_LABEL_KEY_OPTIONS_RESOLVER,
  METRICSTREAM_LABEL_VALUE_OPTIONS_RESOLVER,
  type StreamForPicker,
  type MetricNameInfo,
} from "@checkstack/metricstream-common";

/** How many metric names / label values to offer in a picker (server caps at 500). */
const PICKER_LIMIT = 200;

/** Map a stream summary to a picker option (value = id, label = name). */
export function streamToOption(stream: StreamForPicker): ResolverOption {
  return { value: stream.id, label: stream.name };
}

/**
 * Map a metric-name summary to a searchable-dropdown option. The label carries
 * the type + unit + series count so an operator can tell metrics apart.
 */
export function metricNameToOption(metric: MetricNameInfo): ResolverOption {
  const unit = metric.unit ? ` ${metric.unit}` : "";
  const label = `${metric.name} (${metric.type}${unit}, ${metric.seriesCount} series)`;
  return { value: metric.name, label };
}

/** Map a raw string (label key or value) to a picker option. */
export function stringToOption(value: string): ResolverOption {
  return { value, label: value };
}

/**
 * Read the stream the operator selected in the STRATEGY form. The collector
 * lives in a sibling form, so the editor passes the strategy config down as
 * context; the field key is the strategy's own `streamId`.
 */
export function readSelectedStreamId(
  strategyConfig: Record<string, unknown>,
): string | undefined {
  const streamId = strategyConfig.streamId;
  return typeof streamId === "string" && streamId.length > 0
    ? streamId
    : undefined;
}

/**
 * Read the `metricName` chosen in the SAME collector form (the `metric-window`
 * collector's own top-level field). The label-key/value resolvers read it from
 * the `formValues` the editor hands them.
 */
export function readCollectorMetricName(
  formValues: Record<string, unknown>,
): string | undefined {
  const metricName = formValues.metricName;
  return typeof metricName === "string" && metricName.length > 0
    ? metricName
    : undefined;
}

/**
 * Read a `labelFilters` ROW's own `key`. The label-VALUE resolver needs the key
 * of the array item it belongs to, which requires the DynamicForm row-scoped
 * formValues capability (an array item's resolver sees its own row's siblings
 * merged over the whole-form values). Returns undefined until a key is chosen.
 */
export function readRowLabelKey(
  formValues: Record<string, unknown>,
): string | undefined {
  const key = formValues.key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

/**
 * Build the metric-stream editor dropdown resolvers from the health-check
 * editor's generic context. Contributed to `HealthCheckConfigOptionsResolverSlot`;
 * see `metricstream-common`'s resolver-name constants for the annotation contract.
 *
 * - `metricstreamStreamId` lists every stream the caller can pick
 *   (`listStreamsForPicker` is `typeScoped`, so a team-scoped stream manager
 *   gets options without the global rule).
 * - `metricstreamMetricName` lists the metric names of the stream chosen in the
 *   strategy form (searchable dropdown); `[]` until a stream is selected.
 * - `metricstreamLabelKey` lists the DISTINCT label keys of the metric chosen in
 *   the SAME collector form; `[]` until a metric is selected.
 * - `metricstreamLabelValue` lists the DISTINCT values for the metric AND the
 *   filter row's own `key`. It reads `metricName` from the collector form and
 *   `key` from ITS ROW (row-scoped formValues); `[]` until both are chosen.
 */
export function buildMetricstreamOptionsResolvers({
  rpcApi,
  strategyConfig,
}: ConfigOptionsResolverContext): Record<string, OptionsResolver> {
  const client = rpcApi.forPlugin(MetricstreamApi);

  const streamIdResolver: OptionsResolver = async () => {
    const streams = await client.listStreamsForPicker();
    return streams.map((stream) => streamToOption(stream));
  };

  const metricNameResolver: OptionsResolver = async () => {
    const streamId = readSelectedStreamId(strategyConfig);
    if (!streamId) return [];
    const { names } = await client.listMetricNames({
      streamId,
      limit: PICKER_LIMIT,
    });
    return names.map((metric) => metricNameToOption(metric));
  };

  const labelKeyResolver: OptionsResolver = async (formValues) => {
    const streamId = readSelectedStreamId(strategyConfig);
    const metricName = readCollectorMetricName(formValues);
    if (!streamId || !metricName) return [];
    const { keys } = await client.listLabelKeys({
      streamId,
      metricName,
      limit: PICKER_LIMIT,
    });
    return keys.map((key) => stringToOption(key));
  };

  const labelValueResolver: OptionsResolver = async (formValues) => {
    const streamId = readSelectedStreamId(strategyConfig);
    const metricName = readCollectorMetricName(formValues);
    const key = readRowLabelKey(formValues);
    if (!streamId || !metricName || !key) return [];
    const { values } = await client.listLabelValues({
      streamId,
      metricName,
      key,
      limit: PICKER_LIMIT,
    });
    return values.map((value) => stringToOption(value));
  };

  return {
    [METRICSTREAM_STREAM_OPTIONS_RESOLVER]: streamIdResolver,
    [METRICSTREAM_METRIC_NAME_OPTIONS_RESOLVER]: metricNameResolver,
    [METRICSTREAM_LABEL_KEY_OPTIONS_RESOLVER]: labelKeyResolver,
    [METRICSTREAM_LABEL_VALUE_OPTIONS_RESOLVER]: labelValueResolver,
  };
}
