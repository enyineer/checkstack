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
import type { StoredHealthCheckResult } from "@checkstack/healthcheck-common";
import { Card, CardContent, CardHeader, CardTitle } from "@checkstack/ui";
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
} from "recharts";

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

  if (loading) {
    return; // Don't show loading state, let custom charts render first
  }

  if (!schemas) {
    return;
  }

  // Choose schema based on context type
  const schema =
    context.type === "raw"
      ? schemas.resultSchema
      : schemas.aggregatedResultSchema;

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
    <div className="space-y-6 mt-4">
      {/* Strategy-level fields */}
      {strategyFields.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {strategyFields.map((field) => (
            <AutoChartCard key={field.name} field={field} context={context} />
          ))}
        </div>
      )}

      {/* Collector groups */}
      {collectorGroups.map((group) => (
        <CollectorGroup
          key={group.instanceKey}
          group={group}
          context={context}
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
      const displayName =
        instanceKeys.length === 1
          ? collectorId.split(".").pop() || collectorId
          : `${collectorId.split(".").pop() || collectorId} #${index + 1}`;

      groups.push({
        instanceKey,
        collectorId,
        displayName,
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
 */
function CollectorGroup({
  group,
  context,
}: {
  group: CollectorGroupData;
  context: HealthCheckDiagramSlotContext;
}) {
  // Get assertion status for this collector instance
  const assertionFailed = getAssertionFailed(context, group.instanceKey);

  return (
    <div>
      <h4 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">
        {group.displayName}
      </h4>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Assertion status card */}
        <AssertionStatusCard assertionFailed={assertionFailed} />

        {/* Field cards */}
        {group.fields.map((field) => (
          <AutoChartCard
            key={`${field.instanceKey}-${field.name}`}
            field={field}
            context={context}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Get the _assertionFailed value for a specific collector instance.
 */
function getAssertionFailed(
  context: HealthCheckDiagramSlotContext,
  instanceKey: string,
): string | undefined {
  if (context.type === "raw" && context.runs.length > 0) {
    const latestRun = context.runs[0];
    const result = latestRun.result as StoredHealthCheckResult | undefined;
    const collectors = result?.metadata?.collectors as
      | Record<string, Record<string, unknown>>
      | undefined;
    const collectorData = collectors?.[instanceKey];
    return collectorData?._assertionFailed as string | undefined;
  }
  return undefined;
}

/**
 * Card showing assertion pass/fail status.
 */
function AssertionStatusCard({
  assertionFailed,
}: {
  assertionFailed: string | undefined;
}) {
  if (!assertionFailed) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Assertion</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-green-600">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span>Passed</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-red-200 dark:border-red-900">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-red-600">
          Assertion Failed
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950 px-2 py-1 rounded">
          {assertionFailed}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Discover collector instances from actual run data.
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

  if (context.type === "raw") {
    for (const run of context.runs) {
      const result = run.result as StoredHealthCheckResult | undefined;
      const collectors = result?.metadata?.collectors as
        | Record<string, unknown>
        | undefined;
      addInstances(collectors);
    }
  } else {
    for (const bucket of context.buckets) {
      const collectors = (
        bucket.aggregatedResult as Record<string, unknown> | undefined
      )?.collectors as Record<string, unknown> | undefined;
      addInstances(collectors);
    }
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
}

/**
 * Individual chart card that renders based on field type.
 */
function AutoChartCard({ field, context }: AutoChartCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{field.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartRenderer field={field} context={context} />
      </CardContent>
    </Card>
  );
}

interface ChartRendererProps {
  field: ExpandedChartField;
  context: HealthCheckDiagramSlotContext;
}

/**
 * Dispatches to appropriate chart renderer based on chart type.
 */
function ChartRenderer({ field, context }: ChartRendererProps) {
  switch (field.chartType) {
    case "line": {
      return <LineChartRenderer field={field} context={context} />;
    }
    case "gauge": {
      return <GaugeRenderer field={field} context={context} />;
    }
    case "counter": {
      return <CounterRenderer field={field} context={context} />;
    }
    case "bar": {
      return <BarChartRenderer field={field} context={context} />;
    }
    case "pie": {
      return <PieChartRenderer field={field} context={context} />;
    }
    case "boolean": {
      return <BooleanRenderer field={field} context={context} />;
    }
    case "text": {
      return <TextRenderer field={field} context={context} />;
    }
    case "status": {
      return <StatusRenderer field={field} context={context} />;
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

  // If there's only one unique value, show it prominently with count
  if (entries.length === 1) {
    const [value, count] = entries[0];
    return (
      <div className="text-2xl font-bold">
        {value}
        <span className="text-sm font-normal text-muted-foreground ml-2">
          ({count}×)
        </span>
      </div>
    );
  }

  // Multiple unique values: show as a compact list
  return (
    <div className="space-y-1">
      {entries.slice(0, 5).map(([value, count]) => (
        <div key={value} className="flex items-center justify-between">
          <span className="font-mono text-sm">{value}</span>
          <span className="text-muted-foreground text-sm">{count}×</span>
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
function GaugeRenderer({ field, context }: ChartRendererProps) {
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
    <div className="flex items-center gap-3">
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
  );
}

/**
 * Renders a boolean indicator (success/failure).
 */
function BooleanRenderer({ field, context }: ChartRendererProps) {
  const value = getLatestValue(field.name, context, field.instanceKey);
  const isTrue = value === true;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-3 h-3 rounded-full ${
          isTrue ? "bg-green-500" : "bg-red-500"
        }`}
      />
      <span className={isTrue ? "text-green-600" : "text-red-600"}>
        {isTrue ? "Yes" : "No"}
      </span>
    </div>
  );
}

/**
 * Renders text value.
 */
function TextRenderer({ field, context }: ChartRendererProps) {
  const value = getLatestValue(field.name, context, field.instanceKey);
  const displayValue = formatTextValue(value);

  return (
    <div
      className="text-sm font-mono text-muted-foreground truncate"
      title={displayValue}
    >
      {displayValue || "—"}
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
    <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950 px-2 py-1 rounded truncate">
      {String(value)}
    </div>
  );
}

/**
 * Renders an area chart for time series data using Recharts AreaChart.
 */
function LineChartRenderer({ field, context }: ChartRendererProps) {
  const values = getAllValues(field.name, context, field.instanceKey);
  const unit = field.unit ?? "";

  if (values.length === 0) {
    return <div className="text-muted-foreground">No data</div>;
  }

  // Transform values to recharts data format
  const chartData = values.map((value, index) => ({
    index,
    value,
  }));

  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  return (
    <div className="space-y-2">
      <div className="text-lg font-medium">
        Avg: {avg.toFixed(1)}
        {unit && (
          <span className="text-sm font-normal text-muted-foreground ml-1">
            {unit}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={60}>
        <AreaChart data={chartData}>
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
              const data = payload[0].payload as { value: number };
              return (
                <div
                  className="rounded-md border bg-popover p-2 text-sm shadow-md"
                  style={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                  }}
                >
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
                className="rounded-md border bg-popover p-2 text-sm shadow-md"
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
                  className="rounded-md border bg-popover p-2 text-sm shadow-md"
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
 *
 * For raw runs: returns the latest value from result.metadata
 * For aggregated buckets: combines record values (counters) across ALL buckets,
 * or returns the latest for non-aggregatable types.
 */
function getLatestValue(
  fieldName: string,
  context: HealthCheckDiagramSlotContext,
  collectorId?: string,
): unknown {
  if (context.type === "raw") {
    const runs = context.runs;
    if (runs.length === 0) return undefined;
    // For raw runs, aggregate across all runs for record types
    const allValues = runs.map((run) => {
      const result = run.result as StoredHealthCheckResult | undefined;
      return getFieldValue(result?.metadata, fieldName, collectorId);
    });

    // If the values are record types (like statusCodeCounts), combine them
    const firstVal = allValues.find((v) => v !== undefined);
    if (firstVal && typeof firstVal === "object" && !Array.isArray(firstVal)) {
      return combineRecordValues(allValues as Record<string, number>[]);
    }
    // For simple values, return the latest
    return allValues.at(-1);
  } else {
    const buckets = context.buckets;
    if (buckets.length === 0) return undefined;

    // Get all values for this field from all buckets
    const allValues = buckets.map((bucket) =>
      getFieldValue(
        bucket.aggregatedResult as Record<string, unknown>,
        fieldName,
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
 * Count occurrences of each unique value for a field across all runs/buckets.
 * Returns a record mapping each unique value to its count.
 */
function getValueCounts(
  fieldName: string,
  context: HealthCheckDiagramSlotContext,
  collectorId?: string,
): Record<string, number> {
  const counts: Record<string, number> = {};

  if (context.type === "raw") {
    for (const run of context.runs) {
      const result = run.result as StoredHealthCheckResult | undefined;
      const value = getFieldValue(result?.metadata, fieldName, collectorId);
      if (value !== undefined && value !== null) {
        const key = String(value);
        counts[key] = (counts[key] || 0) + 1;
      }
    }
  } else {
    // For aggregated buckets, we need to look at each bucket's data
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
  }

  return counts;
}

/**
 * Get all numeric values for a field from the context.
 *
 * For raw runs, the strategy-specific data is inside result.metadata.
 * For aggregated buckets, the data is directly in aggregatedResult.
 *
 * NOTE: Returns values in chronological order (oldest first) for proper
 * left-to-right time display in charts. Data comes from API in newest-first
 * order, so we reverse it here.
 */
function getAllValues(
  fieldName: string,
  context: HealthCheckDiagramSlotContext,
  collectorId?: string,
): number[] {
  if (context.type === "raw") {
    return context.runs
      .map((run) => {
        // result is typed as StoredHealthCheckResult with { status, latencyMs, message, metadata }
        const result = run.result as StoredHealthCheckResult;
        return getFieldValue(result?.metadata, fieldName, collectorId);
      })
      .filter((v): v is number => typeof v === "number")
      .toReversed();
  }
  return context.buckets
    .map((bucket) =>
      getFieldValue(
        bucket.aggregatedResult as Record<string, unknown>,
        fieldName,
        collectorId,
      ),
    )
    .filter((v): v is number => typeof v === "number")
    .toReversed();
}

/**
 * Format a value for text display.
 */
function formatTextValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
