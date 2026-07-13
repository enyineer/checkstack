import type { OptionsResolver, ResolverOption } from "@checkstack/ui";
import type { ConfigOptionsResolverContext } from "@checkstack/healthcheck-frontend";
import {
  LogstreamApi,
  LOGSTREAM_STREAM_OPTIONS_RESOLVER,
  LOGSTREAM_PATTERN_OPTIONS_RESOLVER,
  LOGSTREAM_VARIABLE_OPTIONS_RESOLVER,
  type StreamForPicker,
  type LogPattern,
  type PatternVariableSample,
} from "@checkstack/logstream-common";

/** How many patterns to offer in the picker (server caps at 500). */
const PATTERN_PICKER_LIMIT = 200;
/** Keep pattern-template labels readable in a dropdown. */
const PATTERN_LABEL_MAX = 80;
/**
 * A wildcard position is treated as "numeric" (and offered without a caveat)
 * when at least half of its recent samples parsed as finite numbers. Below this
 * the option is still selectable but flagged, since the pattern-metric collector
 * only aggregates the numeric samples.
 */
const NUMERIC_MAJORITY_THRESHOLD = 0.5;

/** Map a stream summary to a picker option (value = id, label = name). */
export function streamToOption(stream: StreamForPicker): ResolverOption {
  return { value: stream.id, label: stream.name };
}

/** Collapse a Drain template to a single-line, length-capped dropdown label. */
export function truncatePatternLabel(
  template: string,
  max: number = PATTERN_LABEL_MAX,
): string {
  const oneLine = template.replaceAll(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

/** Map a Drain pattern to a picker option, labeled by its (truncated) template. */
export function patternToOption(pattern: LogPattern): ResolverOption {
  return {
    value: pattern.id,
    label: truncatePatternLabel(pattern.template),
  };
}

/**
 * Read the stream the operator selected in the STRATEGY form. The
 * `pattern-occurrence` collector lives in a sibling form, so the editor passes
 * the strategy config down as context; the field key is the strategy's own
 * `streamId`. Returns undefined when nothing is chosen yet.
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
 * Read the `patternId` the operator chose in the SAME collector form. The
 * variable-index picker resolves against the pattern selected right beside it
 * (the pattern-metric collector's own `patternId` field), so it reads from the
 * `formValues` the editor hands the resolver - not from the strategy config.
 * Returns undefined until a pattern is chosen.
 */
export function readCollectorPatternId(
  formValues: Record<string, unknown>,
): string | undefined {
  const patternId = formValues.patternId;
  return typeof patternId === "string" && patternId.length > 0
    ? patternId
    : undefined;
}

/**
 * Render the sample-summary window compactly for the "no samples" label:
 * whole days as `Nd` (but a single day stays `24h` - the more natural unit
 * for a day-long lookback), whole hours as `Nh`, anything else in minutes.
 */
export function formatSummaryWindow(seconds: number): string {
  if (seconds % 86_400 === 0 && seconds > 86_400) return `${seconds / 86_400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${Math.round(seconds / 60)}m`;
}

/**
 * Map a wildcard-position summary to a picker option. The label names the
 * position, quotes its template context (so the operator can tell WHICH `<*>`
 * this is - templates can also contain embedded wildcards like `db-<*>` that
 * are not variables), and previews a few recent values. A slot with samples
 * but a non-numeric majority is flagged; a slot with NO samples in the
 * summary window says so with the actual window instead - no samples is not
 * evidence of non-numericness.
 */
export function variableToOption({
  variable,
  summaryWindowSeconds,
}: {
  variable: PatternVariableSample;
  summaryWindowSeconds: number;
}): ResolverOption {
  const position = variable.context
    ? `Variable ${variable.varIndex} (${variable.context})`
    : `Variable ${variable.varIndex}`;
  const samples = variable.sampleValues.slice(0, 3);
  if (samples.length === 0) {
    const window = formatSummaryWindow(summaryWindowSeconds);
    return {
      value: String(variable.varIndex),
      label: `${position} - no samples in the last ${window}`,
    };
  }
  const isNumeric = variable.numericShare >= NUMERIC_MAJORITY_THRESHOLD;
  const label = `${position} - samples: ${samples.join(", ")}${
    isNumeric ? "" : " (not numeric)"
  }`;
  return { value: String(variable.varIndex), label };
}

/**
 * Build the log-stream editor dropdown resolvers from the health-check editor's
 * generic context. Contributed to `HealthCheckConfigOptionsResolverSlot`; see
 * `logstream-common`'s resolver-name constants for the annotation contract.
 *
 * - `logstreamStreamId` lists every stream the caller can pick (the
 *   `listStreamsForPicker` procedure is `typeScoped`, so a team-scoped stream
 *   manager gets options without the global rule - no extra client gating).
 * - `logstreamPatternId` lists the Drain patterns of the stream chosen in the
 *   strategy form; it returns `[]` until a stream is selected. It resolves
 *   against the stream selected at the moment the collector form mounts (the
 *   editor remounts sections on navigation), so re-opening the collector after
 *   changing the stream shows the new stream's patterns.
 * - `logstreamVariableIndex` lists the `<*>` wildcard positions of the pattern
 *   chosen in the SAME collector form (the pattern-metric collector). It reads
 *   `streamId` from the strategy config and `patternId` from the collector's own
 *   `formValues`, and returns `[]` until both are chosen.
 */
export function buildLogstreamOptionsResolvers({
  rpcApi,
  strategyConfig,
}: ConfigOptionsResolverContext): Record<string, OptionsResolver> {
  const client = rpcApi.forPlugin(LogstreamApi);

  const streamIdResolver: OptionsResolver = async () => {
    const streams = await client.listStreamsForPicker();
    return streams.map((stream) => streamToOption(stream));
  };

  const patternIdResolver: OptionsResolver = async () => {
    const streamId = readSelectedStreamId(strategyConfig);
    if (!streamId) return [];
    const patterns = await client.listPatterns({
      streamId,
      limit: PATTERN_PICKER_LIMIT,
    });
    return patterns.map((pattern) => patternToOption(pattern));
  };

  const variableIndexResolver: OptionsResolver = async (formValues) => {
    const streamId = readSelectedStreamId(strategyConfig);
    const patternId = readCollectorPatternId(formValues);
    if (!streamId || !patternId) return [];
    const { variables, summaryWindowSeconds } =
      await client.listPatternVariables({
        streamId,
        patternId,
      });
    return variables.map((variable) =>
      variableToOption({ variable, summaryWindowSeconds }),
    );
  };

  return {
    [LOGSTREAM_STREAM_OPTIONS_RESOLVER]: streamIdResolver,
    [LOGSTREAM_PATTERN_OPTIONS_RESOLVER]: patternIdResolver,
    [LOGSTREAM_VARIABLE_OPTIONS_RESOLVER]: variableIndexResolver,
  };
}
