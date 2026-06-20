/**
 * AutoChartGrid - Renders auto-generated charts based on schema metadata.
 *
 * Parses the strategy's result/aggregated schemas to extract chart metadata
 * and renders appropriate visualizations for each annotated field.
 */

import type { ChartField } from "./schema-parser";
import { extractChartFields, getFieldValue } from "./schema-parser";
import { useStrategySchemas } from "./useStrategySchemas";
import type { HealthCheckDiagramSlotContext } from "../slots";
import { SparklineTooltip } from "../components/SparklineTooltip";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  usePerformance,
  useIsMobile,
} from "@checkstack/ui";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  RadialBarChart,
  RadialBar,
  ReferenceArea,
} from "recharts";
import {
  AnomalyApi,
  type AnomalyBaselineDto,
} from "@checkstack/anomaly-common";
import { usePluginClient } from "@checkstack/frontend-api";
import { format } from "date-fns";
import { MAX_SPARKLINE_BARS } from "../utils/sparkline-downsampling";

interface AutoChartGridProps {
  context: HealthCheckDiagramSlotContext;
}

/**
 * Main component that renders a grid of auto-generated charts.
 *
 * Discovers actual collector instances from run data and creates
 * separate charts for each instance, grouped with headings.
 */
export function AutoChartGrid({ context }: AutoChartGridProps) {
  const { schemas, loading } = useStrategySchemas(context.strategyId);
  const anomalyClient = usePluginClient(AnomalyApi);
  const { data: baselines = [] } = anomalyClient.getAnomalyBaselines.useQuery({
    systemId: context.systemId,
    configurationId: context.configurationId,
  });

  if (loading) {
    return; // Don't show loading state, let custom charts render first
  }

  if (!schemas) {
    return;
  }

  // Always use aggregated result schema
  const schema = schemas.aggregatedResultSchema;

  if (!schema) {
    return;
  }

  const schemaFields = extractChartFields(schema);
  if (schemaFields.length === 0) {
    return;
  }

  // Discover actual collector instances from run data
  const instanceMap = discoverCollectorInstances(context);

  // Separate strategy-level fields from collector fields
  const strategyFields = schemaFields.filter((f) => !f.collectorId);

  // Build grouped collector fields
  const collectorGroups = buildCollectorGroups(schemaFields, instanceMap);

  return (
    <div className="mt-4 space-y-6">
      {/* Strategy-level fields */}
      {strategyFields.length > 0 && (
        <div className="space-y-4">
          {strategyFields.map((field) => (
            <AutoChartCard
              key={field.name}
              field={field}
              context={context}
              baselines={baselines}
            />
          ))}
        </div>
      )}

      {/* Collector groups */}
      {collectorGroups.map((group) => (
        <CollectorGroup
          key={group.instanceKey}
          group={group}
          context={context}
          baselines={baselines}
        />
      ))}
    </div>
  );
}

/**
 * A group of fields for a single collector instance.
 */
interface CollectorGroupData {
  instanceKey: string;
  collectorId: string;
  displayName: string;
  instanceLabel?: string;
  fields: ExpandedChartField[];
}

/**
 * Build grouped collector data from schema fields and instance map.
 */
function buildCollectorGroups(
  schemaFields: ChartField[],
  instanceMap: Record<string, string[]>,
): CollectorGroupData[] {
  const groups: CollectorGroupData[] = [];

  // Process each collector type
  for (const [collectorId, instanceKeys] of Object.entries(instanceMap)) {
    // Get fields for this collector type
    const collectorFields = schemaFields.filter(
      (f) => f.collectorId === collectorId,
    );
    if (collectorFields.length === 0) continue;

    // Create a group for each instance
    for (const [index, instanceKey] of instanceKeys.entries()) {
      const displayName = collectorId.split(".").pop() || collectorId;
      const instanceLabel =
        instanceKeys.length > 1 ? `#${index + 1}` : undefined;

      groups.push({
        instanceKey,
        collectorId,
        displayName,
        instanceLabel,
        fields: collectorFields.map((field) => ({
          ...field,
          instanceKey,
        })),
      });
    }
  }

  return groups;
}

/**
 * Renders a collector group with heading, assertion status, and field cards.
 * Cards are organized into two sections: narrow cards that fill together,
 * and wide timeline cards that span full width.
 */
function CollectorGroup({
  group,
  context,
  baselines,
}: {
  group: CollectorGroupData;
  context: HealthCheckDiagramSlotContext;
  baselines: AnomalyBaselineDto[];
}) {
  // Order: narrow (summary) cards first, then wide timeline cards.
  // Layout is now fully stacked at 100% width.
  const narrowFields = group.fields.filter(
    (f) => !WIDE_CHART_TYPES.has(f.chartType),
  );
  const wideFields = group.fields.filter((f) =>
    WIDE_CHART_TYPES.has(f.chartType),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 pb-2 border-b">
        <h3 className="text-lg font-semibold capitalize">
          {group.displayName}
        </h3>
        {group.instanceLabel && (
          <span className="text-sm font-medium text-muted-foreground">
            {group.instanceLabel}
          </span>
        )}
        <Badge variant="outline" className="font-mono">
          {group.collectorId}
        </Badge>
      </div>

      <div className="space-y-4">
        {narrowFields.map((field) => (
          <AutoChartCard
            key={`${field.instanceKey}-${field.name}`}
            field={field}
            context={context}
            baselines={baselines}
          />
        ))}

        <AssertionStatusCard
          context={context}
          instanceKey={group.instanceKey}
        />

        {wideFields.map((field) => (
          <AutoChartCard
            key={`${field.instanceKey}-${field.name}`}
            field={field}
            context={context}
            baselines={baselines}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Get all assertion results for a specific collector instance.
 * Returns array of results with timestamps/time spans in chronological order.
 * Uses bucket counts with time span from aggregated data.
 */
interface AssertionResult {
  passedCount: number;
  failedCount: number;
  errorMessage?: string;
  timeLabel: string;
  bucketStart: number;
  bucketIntervalSeconds: number;
}

function getAllAssertionResults(
  context: HealthCheckDiagramSlotContext,
  _instanceKey: string,
): AssertionResult[] {
  return context.buckets.map((bucket) => {
    const failedCount = bucket.degradedCount + bucket.unhealthyCount;
    const passedCount = bucket.healthyCount;
    const bucketStart = new Date(bucket.bucketStart);
    const bucketEnd = new Date(bucket.bucketEnd);
    const timeSpan = `${format(bucketStart, "MMM d, HH:mm")} - ${format(bucketEnd, "HH:mm")}`;

    let errorMessage: string | undefined;
    if (failedCount > 0) {
      const parts: string[] = [];
      if (bucket.unhealthyCount > 0) {
        parts.push(`${bucket.unhealthyCount} unhealthy`);
      }
      if (bucket.degradedCount > 0) {
        parts.push(`${bucket.degradedCount} degraded`);
      }
      errorMessage = `${parts.join(", ")} of ${bucket.runCount} runs`;
    }

    return {
      passedCount,
      failedCount,
      errorMessage,
      timeLabel: timeSpan,
      bucketStart: bucketStart.getTime(),
      bucketIntervalSeconds: bucket.bucketIntervalSeconds,
    };
  });
}

interface AssertionDatum {
  bucketStart: number;
  passed: number;
  failed: number;
  total: number;
  timeLabel: string;
  errorMessage?: string;
}

const MAX_ASSERTION_BARS = 50;

function downsampleAssertion(results: AssertionResult[]): AssertionDatum[] {
  if (results.length === 0) return [];

  const groupSize = Math.max(1, Math.ceil(results.length / MAX_ASSERTION_BARS));
  const out: AssertionDatum[] = [];

  for (let i = 0; i < results.length; i += groupSize) {
    const slice = results.slice(i, i + groupSize);
    const first = slice[0];
    let passed = 0;
    let failed = 0;
    const failureMessages: string[] = [];
    for (const r of slice) {
      passed += r.passedCount;
      failed += r.failedCount;
      if (r.errorMessage) failureMessages.push(r.errorMessage);
    }
    const startLabel = first.timeLabel.split(" - ")[0];
    const endLabel = slice.at(-1)?.timeLabel.split(" - ").pop() ?? startLabel;
    const timeLabel =
      slice.length === 1 ? first.timeLabel : `${startLabel} – ${endLabel}`;

    out.push({
      bucketStart: first.bucketStart,
      passed,
      failed,
      total: passed + failed,
      timeLabel,
      errorMessage:
        failed > 0
          ? failureMessages.length === 1
            ? failureMessages[0]
            : `${failed} of ${passed + failed} runs failed`
          : undefined,
    });
  }

  return out;
}

function AssertionSparkline({
  results,
  isLowPower,
}: {
  results: AssertionResult[];
  isLowPower: boolean;
}) {
  const data = downsampleAssertion(results);
  if (data.length === 0) return <></>;

  const intervalSeconds = results[0]?.bucketIntervalSeconds ?? 3600;
  const effectiveInterval =
    intervalSeconds *
    Math.max(1, Math.ceil(results.length / MAX_ASSERTION_BARS));
  const tickFmt =
    effectiveInterval >= 86_400
      ? "MMM d"
      : effectiveInterval >= 3600
        ? "MMM d HH:mm"
        : "HH:mm";

  return (
    <div className="w-full h-12">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 2, right: 2, left: 2, bottom: 0 }}
          barCategoryGap={2}
        >
          <XAxis
            dataKey="bucketStart"
            tickFormatter={(value: number) => format(new Date(value), tickFmt)}
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            minTickGap={48}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis hide domain={[0, "dataMax"]} />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.3 }}
            content={(props) => (
              <AssertionTooltip
                active={props.active}
                payload={
                  props.payload as unknown as
                    | { payload: AssertionDatum }[]
                    | undefined
                }
              />
            )}
          />
          <Bar
            dataKey="passed"
            stackId="assertion"
            fill="hsl(var(--success))"
            isAnimationActive={!isLowPower}
          />
          <Bar
            dataKey="failed"
            stackId="assertion"
            fill="hsl(var(--destructive))"
            isAnimationActive={!isLowPower}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AssertionTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: AssertionDatum }[];
}) {
  if (!active || !payload?.length) return <></>;
  const datum = payload[0].payload;
  const passRate =
    datum.total > 0 ? Math.round((datum.passed / datum.total) * 100) : 0;
  return (
    <div
      className="p-2 text-xs rounded-md shadow-md"
      style={{
        backgroundColor: "hsl(var(--popover))",
        border: "1px solid hsl(var(--border))",
        color: "hsl(var(--popover-foreground))",
      }}
    >
      <p className="mb-1 text-muted-foreground">{datum.timeLabel}</p>
      <div className="space-y-0.5">
        <p>
          <span style={{ color: "hsl(var(--success))" }}>●</span> Passed:{" "}
          {datum.passed}
        </p>
        {datum.failed > 0 && (
          <p>
            <span style={{ color: "hsl(var(--destructive))" }}>●</span> Failed:{" "}
            {datum.failed}
          </p>
        )}
        {datum.total > 0 && (
          <p className="pt-0.5 text-muted-foreground">{passRate}% passed</p>
        )}
        {datum.errorMessage && (
          <p className="italic text-muted-foreground max-w-[240px] truncate">
            {datum.errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Card showing assertion pass/fail status with historical sparkline.
 */
function AssertionStatusCard({
  context,
  instanceKey,
}: {
  context: HealthCheckDiagramSlotContext;
  instanceKey: string;
}) {
  const { isLowPower } = usePerformance();
  const results = getAllAssertionResults(context, instanceKey);

  if (results.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-center">
            Assertion
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <div className="text-sm text-muted-foreground">No data</div>
        </CardContent>
      </Card>
    );
  }

  const latestResult = results.at(-1)!;
  const latestPassed = latestResult.failedCount === 0;
  let totalPassed = 0;
  let totalFailed = 0;
  for (const r of results) {
    totalPassed += r.passedCount;
    totalFailed += r.failedCount;
  }
  const totalRuns = totalPassed + totalFailed;
  const passRate =
    totalRuns > 0 ? Math.round((totalPassed / totalRuns) * 100) : 100;
  const allPassed = totalFailed === 0;
  const allFailed = totalPassed === 0 && totalFailed > 0;

  return (
    <Card
      className={latestPassed ? "" : "border-status-down/40"}
    >
      <CardHeader className="pb-2">
        <CardTitle
          className={`text-sm font-medium text-center ${latestPassed ? "" : "text-status-down"}`}
        >
          {latestPassed ? "Assertion" : "Assertion Failed"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-center">
        {/* Current status with rate */}
        <div className="flex items-center justify-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${
              latestPassed ? "bg-status-ok" : "bg-status-down"
            }`}
          />
          <span className={latestPassed ? "text-status-ok" : "text-status-down"}>
            {latestPassed ? "Passed" : "Failed"}
          </span>
          {!allPassed && !allFailed && (
            <span className="text-xs text-muted-foreground">
              ({passRate}% passed)
            </span>
          )}
        </div>

        {/* Error message if failed */}
        {!latestPassed && latestResult.errorMessage && (
          <div className="px-2 py-1 text-sm text-status-down truncate rounded bg-status-down/10">
            {latestResult.errorMessage}
          </div>
        )}

        {/* Sparkline timeline - one bar per bucket, with cursor-tracking tooltip */}
        <AssertionSparkline results={results} isLowPower={isLowPower} />
      </CardContent>
    </Card>
  );
}

/**
 * Discover collector instances from aggregated bucket data.
 * Returns a map from base collector ID (type) to array of instance UUIDs.
 */
function discoverCollectorInstances(
  context: HealthCheckDiagramSlotContext,
): Record<string, string[]> {
  const instanceMap: Record<string, Set<string>> = {};

  const addInstances = (collectors: Record<string, unknown> | undefined) => {
    if (!collectors || typeof collectors !== "object") return;

    for (const [uuid, data] of Object.entries(collectors)) {
      // Read the collector type from the stored _collectorId metadata
      const collectorData = data as Record<string, unknown> | undefined;
      const collectorId = collectorData?._collectorId as string | undefined;

      if (collectorId) {
        if (!instanceMap[collectorId]) {
          instanceMap[collectorId] = new Set();
        }
        instanceMap[collectorId].add(uuid);
      }
    }
  };

  for (const bucket of context.buckets) {
    const collectors = (
      bucket.aggregatedResult as Record<string, unknown> | undefined
    )?.collectors as Record<string, unknown> | undefined;
    addInstances(collectors);
  }

  // Convert sets to arrays
  const result: Record<string, string[]> = {};
  for (const [collectorId, uuids] of Object.entries(instanceMap)) {
    result[collectorId] = [...uuids].toSorted();
  }
  return result;
}

/**
 * Extended ChartField with instance UUID for data lookup.
 */
interface ExpandedChartField extends ChartField {
  /** Instance UUID for data lookup */
  instanceKey?: string;
}

interface AutoChartCardProps {
  field: ExpandedChartField;
  context: HealthCheckDiagramSlotContext;
  baselines?: AnomalyBaselineDto[];
}

/**
 * Chart types that display historical timelines and benefit from wider display.
 */
const WIDE_CHART_TYPES = new Set(["line", "boolean", "text"]);

/**
 * Individual chart card that renders based on field type.
 */
function AutoChartCard({ field, context, baselines }: AutoChartCardProps) {
  const fullFieldPath = field.collectorId
    ? `collectors.${field.collectorId}.${field.name}`
    : field.name;

  let baseline = baselines?.find((b) => b.fieldPath === fullFieldPath);

  // If no exact match, try mapping aggregated field names back to raw field names
  if (!baseline) {
    let rawFieldName = field.name;
    if (rawFieldName.startsWith("avg")) {
      rawFieldName =
        rawFieldName.charAt(3).toLowerCase() + rawFieldName.slice(4);
    } else if (rawFieldName.startsWith("min")) {
      rawFieldName =
        rawFieldName.charAt(3).toLowerCase() + rawFieldName.slice(4);
    } else if (rawFieldName.startsWith("max")) {
      rawFieldName =
        rawFieldName.charAt(3).toLowerCase() + rawFieldName.slice(4);
    } else if (rawFieldName === "successRate") {
      rawFieldName = "success";
    }

    if (rawFieldName !== field.name) {
      const rawFullFieldPath = field.collectorId
        ? `collectors.${field.collectorId}.${rawFieldName}`
        : rawFieldName;
      baseline = baselines?.find((b) => b.fieldPath === rawFullFieldPath);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-center">
          {field.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center text-center [&>*]:w-full">
        <ChartRenderer field={field} context={context} baseline={baseline} />
      </CardContent>
    </Card>
  );
}

interface ChartRendererProps {
  field: ExpandedChartField;
  context: HealthCheckDiagramSlotContext;
  baseline?: AnomalyBaselineDto;
}

/**
 * Dispatches to appropriate chart renderer based on chart type.
 */
function ChartRenderer({ field, context, baseline }: ChartRendererProps) {
  switch (field.chartType) {
    case "line": {
      return (
        <LineChartRenderer
          field={field}
          context={context}
          baseline={baseline}
        />
      );
    }
    case "gauge": {
      return (
        <GaugeRenderer field={field} context={context} baseline={baseline} />
      );
    }
    case "counter": {
      return (
        <CounterRenderer field={field} context={context} baseline={baseline} />
      );
    }
    case "bar": {
      return (
        <BarChartRenderer field={field} context={context} baseline={baseline} />
      );
    }
    case "pie": {
      return (
        <PieChartRenderer field={field} context={context} baseline={baseline} />
      );
    }
    case "boolean": {
      return (
        <BooleanRenderer field={field} context={context} baseline={baseline} />
      );
    }
    case "text": {
      return (
        <TextRenderer field={field} context={context} baseline={baseline} />
      );
    }
    case "status": {
      return (
        <StatusRenderer field={field} context={context} baseline={baseline} />
      );
    }
    default: {
      return;
    }
  }
}

// =============================================================================
// CHART RENDERERS
// =============================================================================

/**
 * Renders a counter showing frequency distribution of all unique values.
 * Counts how many times each value appears across all runs/buckets.
 */
function CounterRenderer({ field, context }: ChartRendererProps) {
  const counts = getValueCounts(field.name, context, field.instanceKey);
  const entries = Object.entries(counts);

  if (entries.length === 0) {
    return <div className="text-muted-foreground">No data</div>;
  }

  // Sort by count (descending) then by value
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  // If there's only one unique value, show it prominently
  // Only show count multiplier if > 1 (avoids confusing "(1×)" for aggregated counters)
  if (entries.length === 1) {
    const [value, count] = entries[0];
    return (
      <div className="text-2xl font-bold">
        {value}
        {count > 1 && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({count}×)
          </span>
        )}
      </div>
    );
  }

  // Multiple unique values: show as a compact list
  return (
    <div className="space-y-1">
      {entries.slice(0, 5).map(([value, count]) => (
        <div key={value} className="flex items-center justify-between">
          <span className="font-mono text-sm">{value}</span>
          <span className="text-sm text-muted-foreground">{count}×</span>
        </div>
      ))}
      {entries.length > 5 && (
        <div className="text-xs text-muted-foreground">
          +{entries.length - 5} more
        </div>
      )}
    </div>
  );
}

/**
 * Renders a percentage gauge visualization using Recharts RadialBarChart.
 */
function GaugeRenderer({ field, context, baseline }: ChartRendererProps) {
  const value = getLatestValue(field.name, context, field.instanceKey);
  const numValue =
    typeof value === "number" ? Math.min(100, Math.max(0, value)) : 0;
  const unit = field.unit ?? "%";

  // Determine color based on value (for rates: higher is better)
  const fillColor =
    numValue >= 90
      ? "hsl(var(--success))"
      : numValue >= 70
        ? "hsl(var(--warning))"
        : "hsl(var(--destructive))";

  const data = [{ name: field.label, value: numValue, fill: fillColor }];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-center gap-3">
        <ResponsiveContainer width={80} height={80}>
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="60%"
            outerRadius="100%"
            barSize={8}
            data={data}
            startAngle={90}
            endAngle={-270}
          >
            <RadialBar
              dataKey="value"
              cornerRadius={4}
              background={{ fill: "hsl(var(--muted))" }}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="text-2xl font-bold" style={{ color: fillColor }}>
          {numValue.toFixed(1)}
          {unit}
        </div>
      </div>
      {baseline &&
        (() => {
          if (
            baseline.dominantValue !== undefined &&
            baseline.dominantValue !== null
          ) {
            let expectedNum = Number(baseline.dominantValue);
            if (
              baseline.dominantValue === "true" ||
              baseline.dominantValue === "false"
            ) {
              const ratio =
                baseline.dominantRatio ??
                (baseline.dominantValue === "true" ? 1 : 0);
              expectedNum =
                baseline.dominantValue === "true"
                  ? ratio * 100
                  : (1 - ratio) * 100;
            }
            if (!Number.isNaN(expectedNum)) {
              return (
                <div className="mt-1 text-xs text-muted-foreground">
                  Expected: {expectedNum.toFixed(1)}
                  {unit}
                </div>
              );
            }
          }

          if (typeof baseline.mean === "number") {
            const min = Math.max(0, baseline.mean - baseline.stdDev * 3);
            const max = baseline.mean + baseline.stdDev * 3;
            return (
              <div className="mt-1 text-xs text-muted-foreground">
                Expected: {baseline.mean.toFixed(1)}
                {unit} (±{(baseline.stdDev * 3).toFixed(1)}) [{min.toFixed(1)} -{" "}
                {max.toFixed(1)}]
              </div>
            );
          }

          return <></>;
        })()}
    </div>
  );
}

/**
 * Renders a boolean indicator with historical sparkline.
 */
function BooleanRenderer({ field, context, baseline }: ChartRendererProps) {
  const valuesWithTime = getAllBooleanValuesWithTime(
    field.name,
    context,
    field.instanceKey,
  );

  if (valuesWithTime.length === 0) {
    return <div className="text-sm text-muted-foreground">No data</div>;
  }

  // Calculate success rate
  const trueCount = valuesWithTime.filter((v) => v.value === true).length;
  const successRate = Math.round((trueCount / valuesWithTime.length) * 100);
  const latestValue = valuesWithTime.at(-1)?.value;
  const allSame = valuesWithTime.every(
    (v) => v.value === valuesWithTime[0].value,
  );

  return (
    <div className="space-y-2">
      {/* Current status with rate */}
      <div className="flex items-center justify-center gap-2">
        <div
          className={`w-3 h-3 rounded-full ${
            latestValue ? "bg-status-ok" : "bg-status-down"
          }`}
        />
        <span className={latestValue ? "text-status-ok" : "text-status-down"}>
          {latestValue ? "Yes" : "No"}
        </span>
        {!allSame && (
          <span className="text-xs text-muted-foreground">
            ({successRate}% success)
          </span>
        )}
      </div>

      {baseline &&
        baseline.dominantValue !== undefined &&
        baseline.dominantValue !== null && (
          <div className="text-xs text-muted-foreground">
            Expected: {String(baseline.dominantValue)}
            {baseline.dominantRatio
              ? ` (${(baseline.dominantRatio * 100).toFixed(0)}%)`
              : ""}
          </div>
        )}

      {/* Sparkline timeline - render each value as a bar */}
      <div className="flex h-2 gap-px rounded">
        {valuesWithTime.map((item, index) => {
          const tooltip = item.timeLabel
            ? `${item.timeLabel}\n${item.value ? "Yes" : "No"}`
            : item.value
              ? "Yes"
              : "No";
          return (
            <SparklineTooltip key={index} content={tooltip}>
              <div
                className={`flex-1 h-full ${item.value ? "bg-status-ok" : "bg-status-down"} hover:opacity-80`}
              />
            </SparklineTooltip>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Renders text value with historical sparkline for status-type fields.
 */
function TextRenderer({ field, context, baseline }: ChartRendererProps) {
  const valuesWithTime = getAllStringValuesWithTime(
    field.name,
    context,
    field.instanceKey,
  );

  if (valuesWithTime.length === 0) {
    return <div className="text-sm text-muted-foreground">—</div>;
  }

  const latestValue = valuesWithTime.at(-1)?.value ?? "";
  const uniqueValues = [...new Set(valuesWithTime.map((v) => v.value))];
  const allSame = uniqueValues.length === 1;
  const latestCount = valuesWithTime.filter(
    (v) => v.value === latestValue,
  ).length;

  return (
    <div className="space-y-2">
      {/* Current value with count */}
      <div className="flex items-center justify-center gap-2">
        <span className="font-mono text-sm">{latestValue || "—"}</span>
        {!allSame && (
          <span className="text-xs text-muted-foreground">
            ({latestCount}/{valuesWithTime.length}×)
          </span>
        )}
      </div>

      {baseline &&
        baseline.dominantValue !== undefined &&
        baseline.dominantValue !== null && (
          <div className="text-xs text-muted-foreground">
            Expected: {String(baseline.dominantValue)}
            {baseline.dominantRatio
              ? ` (${(baseline.dominantRatio * 100).toFixed(0)}%)`
              : ""}
          </div>
        )}

      {/* Sparkline timeline - always show for historical context */}
      {(() => {
        // Downsample for string values - bucket is "primary" if all values match latest
        const bucketSize =
          valuesWithTime.length <= MAX_SPARKLINE_BARS
            ? 1
            : Math.ceil(valuesWithTime.length / MAX_SPARKLINE_BARS);

        const buckets: Array<{
          items: typeof valuesWithTime;
          matchesLatest: boolean;
          timeLabel?: string;
        }> = [];
        for (let i = 0; i < valuesWithTime.length; i += bucketSize) {
          const items = valuesWithTime.slice(i, i + bucketSize);
          const matchesLatest = items.every((v) => v.value === latestValue);
          const startLabel = items[0]?.timeLabel;
          const endLabel = items.at(-1)?.timeLabel;
          buckets.push({
            items,
            matchesLatest,
            timeLabel:
              startLabel && endLabel && startLabel !== endLabel
                ? `${startLabel} - ${endLabel}`
                : startLabel,
          });
        }

        return (
          <div className="flex h-2 gap-px rounded">
            {buckets.map((bucket, index) => {
              // Build value distribution for tooltip
              let valueInfo: string;
              if (bucket.items.length === 1) {
                valueInfo = bucket.items[0]?.value ?? "";
              } else {
                // Count occurrences of each value
                const counts: Record<string, number> = {};
                for (const item of bucket.items) {
                  counts[item.value] = (counts[item.value] || 0) + 1;
                }
                // Format as "value: Nx" entries, sorted by count
                valueInfo = Object.entries(counts)
                  .toSorted((a, b) => b[1] - a[1])
                  .slice(0, 3) // Show top 3
                  .map(([val, count]) => `${val}: ${count}×`)
                  .join(", ");
                if (Object.keys(counts).length > 3) {
                  valueInfo += ` (+${Object.keys(counts).length - 3} more)`;
                }
              }
              const tooltip = bucket.timeLabel
                ? `${bucket.timeLabel}\n${valueInfo}`
                : valueInfo;
              return (
                <SparklineTooltip key={index} content={tooltip}>
                  <div
                    className={`flex-1 h-full ${
                      bucket.matchesLatest ? "bg-primary" : "bg-amber-500"
                    } hover:opacity-80`}
                  />
                </SparklineTooltip>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

/**
 * Renders error/status badge.
 */
function StatusRenderer({ field, context }: ChartRendererProps) {
  const value = getLatestValue(field.name, context, field.instanceKey);
  const hasValue = value !== undefined && value !== null && value !== "";

  if (!hasValue) {
    return <div className="text-sm text-muted-foreground">No errors</div>;
  }

  return (
    <div className="px-2 py-1 text-sm text-status-down truncate rounded bg-status-down/10">
      {String(value)}
    </div>
  );
}

/**
 * Renders an area chart for time series data using Recharts AreaChart.
 */
function LineChartRenderer({ field, context, baseline }: ChartRendererProps) {
  const isMobile = useIsMobile();
  const valuesWithTime = getAllValuesWithTime(
    field.name,
    context,
    field.instanceKey,
  );
  const unit = field.unit ?? "";

  if (valuesWithTime.length === 0) {
    return <div className="text-muted-foreground">No data</div>;
  }

  const avg =
    valuesWithTime.reduce((a, b) => a + b.value, 0) / valuesWithTime.length;

  // Calculate average runs per bucket to adjust the visual standard deviation.
  // Since the chart plots the *average* of the bucket, the standard deviation
  // of that average is sigma / sqrt(n). This makes the baseline band visually
  // correct for the aggregated data being displayed.
  const totalRuns = context.buckets.reduce(
    (sum, b) => sum + (b.runCount || 1),
    0,
  );
  const avgRunCount = Math.max(
    1,
    totalRuns / Math.max(1, context.buckets.length),
  );

  // Trend is the slope projected over the baseline window: slope × sampleCount
  // — the same scalar the drift evaluator uses. Surfaced as a header chip rather
  // than a diagonal line because it's a rate, not an absolute value, and shares
  // no natural axis with the data series.
  const projectedChange = baseline
    ? baseline.trendSlope * baseline.sampleCount
    : 0;
  const showTrend = !!baseline && Math.abs(projectedChange) > 0.01;
  const driftSigmas =
    baseline && baseline.stdDev > 0
      ? Math.abs(projectedChange) / baseline.stdDev
      : 0;
  const isDrifting = driftSigmas >= 2;

  const chartData = valuesWithTime.map((item, index) => ({
    index,
    value: item.value,
    timeLabel: item.timeLabel,
  }));

  return (
    <div className="space-y-2">
      {baseline ? (
        <div className="flex items-center justify-between gap-3 px-1 text-xs">
          <span className="font-medium text-warning">
            Expected: {baseline.mean.toFixed(1)}
            {unit} (±
            {((baseline.stdDev / Math.sqrt(avgRunCount)) * 3).toFixed(1)})
          </span>
          <div className="flex items-center gap-3">
            {showTrend && (
              <span
                className={
                  isDrifting
                    ? "text-warning font-medium"
                    : "text-muted-foreground"
                }
              >
                Trend: {projectedChange >= 0 ? "↑ +" : "↓ "}
                {projectedChange.toFixed(1)}
                {unit}
              </span>
            )}
            <span className="text-muted-foreground">
              Avg: {avg.toFixed(1)}
              {unit}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end px-1 text-xs">
          <span className="text-muted-foreground">
            Avg: {avg.toFixed(1)}
            {unit}
          </span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient
              id={`gradient-${field.name}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="5%"
                stopColor="hsl(var(--primary))"
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor="hsl(var(--primary))"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="index"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(index: number) => {
              const label = chartData[index]?.timeLabel;
              return label ? label.split(" - ")[0] : "";
            }}
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            minTickGap={isMobile ? 60 : 30}
            interval={isMobile ? "preserveStartEnd" : undefined}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickFormatter={(v: number) => `${v}${unit}`}
            width={60}
          />
          {baseline && (
            <ReferenceArea
              y1={Math.max(
                0,
                baseline.mean - (baseline.stdDev / Math.sqrt(avgRunCount)) * 3,
              )}
              y2={
                baseline.mean + (baseline.stdDev / Math.sqrt(avgRunCount)) * 3
              }
              fill="hsl(var(--warning))"
              fillOpacity={0.08}
              stroke="hsl(var(--warning))"
              strokeOpacity={0.4}
              strokeWidth={1}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke="hsl(var(--primary))"
            fill={`url(#gradient-${field.name})`}
            strokeWidth={2}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return;
              const data = payload[0].payload as {
                value: number;
                timeLabel: string;
              };
              return (
                <div
                  className="p-2 text-sm border rounded-md shadow-md bg-popover"
                  style={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                  }}
                >
                  <p className="mb-1 text-xs text-muted-foreground">
                    {data.timeLabel}
                  </p>
                  <p className="font-medium">
                    {data.value.toFixed(1)}
                    {unit}
                  </p>
                </div>
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Renders a horizontal bar chart for record values using Recharts BarChart.
 */
function BarChartRenderer({ field, context }: ChartRendererProps) {
  const value = getLatestValue(field.name, context);

  if (!value || typeof value !== "object") {
    return <div className="text-muted-foreground">No data</div>;
  }

  const entries = Object.entries(value as Record<string, number>).slice(0, 8);
  const chartData = entries.map(([name, value]) => ({ name, value }));

  return (
    <ResponsiveContainer
      width="100%"
      height={Math.max(100, entries.length * 28)}
    >
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ left: 20, right: 20 }}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
          width={50}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return;
            const data = payload[0].payload as { name: string; value: number };
            return (
              <div
                className="p-2 text-sm border rounded-md shadow-md bg-popover"
                style={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                }}
              >
                <p className="font-medium">
                  {data.name}: {data.value}
                </p>
              </div>
            );
          }}
        />
        <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Color palette for pie segments
const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(var(--muted))",
];

/**
 * Renders a pie chart for category distribution values using Recharts PieChart.
 * Supports both pre-aggregated objects (like statusCodeCounts) and simple values
 * that need to be counted (like statusCode).
 */
function PieChartRenderer({ field, context }: ChartRendererProps) {
  // First, try to get a pre-aggregated object value
  const value = getLatestValue(field.name, context, field.instanceKey);

  // Determine the data source: use pre-aggregated object or count simple values
  let dataRecord: Record<string, number>;
  // eslint-disable-next-line unicorn/prefer-ternary
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // Already an object (like statusCodeCounts from aggregated schema)
    dataRecord = value as Record<string, number>;
  } else {
    // Simple values (like statusCode) - count occurrences
    dataRecord = getValueCounts(field.name, context, field.instanceKey);
  }

  const entries = Object.entries(dataRecord).slice(0, 8);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  if (total === 0) {
    return <div className="text-muted-foreground">No data</div>;
  }

  const chartData = entries.map(([name, value]) => ({ name, value }));

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={100} height={100}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={25}
            outerRadius={45}
            strokeWidth={0}
          >
            {chartData.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return;
              const data = payload[0].payload as {
                name: string;
                value: number;
              };
              return (
                <div
                  className="p-2 text-sm border rounded-md shadow-md bg-popover"
                  style={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                  }}
                >
                  <p className="font-medium">
                    {data.name}: {data.value} (
                    {((data.value / total) * 100).toFixed(0)}%)
                  </p>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-1 text-xs">
        {chartData.map((item, i) => (
          <div key={item.name} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
            />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="ml-auto font-medium">
              {item.value} ({((item.value / total) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the aggregated value for a field from the context.
 * Combines record values (counters) across ALL buckets,
 * or returns the latest for non-aggregatable types.
 */
function getLatestValue(
  fieldName: string,
  context: HealthCheckDiagramSlotContext,
  collectorId?: string,
): unknown {
  const buckets = context.buckets;
  if (buckets.length === 0) return undefined;

  // Get all values for this field from all buckets
  const allValues = buckets.map((bucket) =>
    getFieldValue(
      bucket.aggregatedResult as Record<string, unknown>,
      fieldName,
      collectorId,
    ),
  );

  // If the values are record types (like statusCodeCounts), combine them
  const firstVal = allValues.find((v) => v !== undefined);
  if (firstVal && typeof firstVal === "object" && !Array.isArray(firstVal)) {
    return combineRecordValues(allValues as Record<string, number>[]);
  }
  // For simple values (like errorCount), sum them
  if (typeof firstVal === "number") {
    return allValues
      .filter((v): v is number => typeof v === "number")
      .reduce((sum, v) => sum + v, 0);
  }
  // For other types, return the latest
  return allValues.at(-1);
}

/**
 * Combine record values (like statusCodeCounts) across multiple buckets/runs.
 * Adds up the counts for each key.
 */
function combineRecordValues(
  values: (Record<string, number> | undefined)[],
): Record<string, number> {
  const combined: Record<string, number> = {};
  for (const val of values) {
    if (!val || typeof val !== "object") continue;
    for (const [key, count] of Object.entries(val)) {
      if (typeof count === "number") {
        combined[key] = (combined[key] || 0) + count;
      }
    }
  }
  return combined;
}

/**
 * Count occurrences of each unique value for a field across all buckets.
 * Returns a record mapping each unique value to its count.
 */
function getValueCounts(
  fieldName: string,
  context: HealthCheckDiagramSlotContext,
  collectorId?: string,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const bucket of context.buckets) {
    const value = getFieldValue(
      bucket.aggregatedResult as Record<string, unknown>,
      fieldName,
      collectorId,
    );
    if (value !== undefined && value !== null) {
      const key = String(value);
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  return counts;
}

/**
 * Get all numeric values for a field with time labels.
 * Returns values in chronological order with time spans for tooltips.
 */
function getAllValuesWithTime(
  fieldName: string,
  context: HealthCheckDiagramSlotContext,
  collectorId?: string,
): { value: number; timeLabel: string }[] {
  return context.buckets
    .map((bucket) => {
      const value = getFieldValue(
        bucket.aggregatedResult as Record<string, unknown>,
        fieldName,
        collectorId,
      );
      if (typeof value !== "number") return;
      const bucketStart = new Date(bucket.bucketStart);
      const bucketEnd = new Date(bucket.bucketEnd);
      return {
        value,
        timeLabel: `${format(bucketStart, "MMM d, HH:mm")} - ${format(bucketEnd, "HH:mm")}`,
      };
    })
    .filter((v): v is { value: number; timeLabel: string } => v !== undefined);
}

/**
 * Get all boolean values for a field from the context.
 * Returns values with time labels in chronological order for sparkline display.
 */
function getAllBooleanValuesWithTime(
  fieldName: string,
  context: HealthCheckDiagramSlotContext,
  collectorId?: string,
): { value: boolean; timeLabel: string }[] {
  return context.buckets
    .map((bucket) => {
      const value = getFieldValue(
        bucket.aggregatedResult as Record<string, unknown>,
        fieldName,
        collectorId,
      );
      if (typeof value !== "boolean") return;
      const bucketStart = new Date(bucket.bucketStart);
      const bucketEnd = new Date(bucket.bucketEnd);
      return {
        value,
        timeLabel: `${format(bucketStart, "MMM d, HH:mm")} - ${format(bucketEnd, "HH:mm")}`,
      };
    })
    .filter((v): v is { value: boolean; timeLabel: string } => v !== undefined);
}

/**
 * Get all string values for a field from the context.
 * Returns values with time labels in chronological order for sparkline display.
 */
function getAllStringValuesWithTime(
  fieldName: string,
  context: HealthCheckDiagramSlotContext,
  collectorId?: string,
): { value: string; timeLabel: string }[] {
  return context.buckets
    .map((bucket) => {
      const value = getFieldValue(
        bucket.aggregatedResult as Record<string, unknown>,
        fieldName,
        collectorId,
      );
      if (typeof value !== "string") return;
      const bucketStart = new Date(bucket.bucketStart);
      const bucketEnd = new Date(bucket.bucketEnd);
      return {
        value,
        timeLabel: `${format(bucketStart, "MMM d, HH:mm")} - ${format(bucketEnd, "HH:mm")}`,
      };
    })
    .filter((v): v is { value: string; timeLabel: string } => v !== undefined);
}
