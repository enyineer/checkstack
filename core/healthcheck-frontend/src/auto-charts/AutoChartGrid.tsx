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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@checkmate-monitor/ui";

interface AutoChartGridProps {
  context: HealthCheckDiagramSlotContext;
}

/**
 * Main component that renders a grid of auto-generated charts.
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

  const fields = extractChartFields(schema);
  if (fields.length === 0) {
    return;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-4">
      {fields.map((field) => (
        <AutoChartCard key={field.name} field={field} context={context} />
      ))}
    </div>
  );
}

interface AutoChartCardProps {
  field: ChartField;
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
  field: ChartField;
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
 * Renders a large counter value with optional trend.
 */
function CounterRenderer({ field, context }: ChartRendererProps) {
  const value = getLatestValue(field.name, context);
  const displayValue = typeof value === "number" ? value : "—";
  const unit = field.unit ?? "";

  return (
    <div className="text-2xl font-bold">
      {displayValue}
      {unit && (
        <span className="text-sm font-normal text-muted-foreground ml-1">
          {unit}
        </span>
      )}
    </div>
  );
}

/**
 * Renders a percentage gauge visualization.
 */
function GaugeRenderer({ field, context }: ChartRendererProps) {
  const value = getLatestValue(field.name, context);
  const numValue =
    typeof value === "number" ? Math.min(100, Math.max(0, value)) : 0;
  const unit = field.unit ?? "%";

  // Determine color based on value (for rates: higher is better)
  const colorClass =
    numValue >= 90
      ? "text-green-500"
      : numValue >= 70
      ? "text-yellow-500"
      : "text-red-500";

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-16 h-16">
        <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 36 36">
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            className="stroke-muted"
            strokeWidth="3"
          />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            className={colorClass.replace("text-", "stroke-")}
            strokeWidth="3"
            strokeDasharray={`${numValue} 100`}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className={`text-2xl font-bold ${colorClass}`}>
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
  const value = getLatestValue(field.name, context);
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
  const value = getLatestValue(field.name, context);
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
  const value = getLatestValue(field.name, context);
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
 * Renders a simple line chart visualization.
 * For now, shows min/avg/max summary. Full charts can be added later.
 */
function LineChartRenderer({ field, context }: ChartRendererProps) {
  const values = getAllValues(field.name, context);
  const unit = field.unit ?? "";

  if (values.length === 0) {
    return <div className="text-muted-foreground">No data</div>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  return (
    <div className="space-y-1">
      <div className="text-2xl font-bold">
        {avg.toFixed(1)}
        {unit && (
          <span className="text-sm font-normal text-muted-foreground ml-1">
            {unit}
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        Min: {min.toFixed(1)}
        {unit} · Max: {max.toFixed(1)}
        {unit}
      </div>
    </div>
  );
}

/**
 * Renders a bar chart for record values.
 */
function BarChartRenderer({ field, context }: ChartRendererProps) {
  const value = getLatestValue(field.name, context);

  if (!value || typeof value !== "object") {
    return <div className="text-muted-foreground">No data</div>;
  }

  const entries = Object.entries(value as Record<string, number>).slice(0, 5);
  const maxValue = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div className="space-y-2">
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="text-xs w-12 text-right text-muted-foreground">
            {key}
          </span>
          <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
            <div
              className="h-full bg-primary"
              style={{ width: `${(val / maxValue) * 100}%` }}
            />
          </div>
          <span className="text-xs w-8">{val}</span>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the latest value for a field from the context.
 *
 * For raw runs, the strategy-specific data is inside result.metadata.
 * For aggregated buckets, the data is directly in aggregatedResult.
 */
function getLatestValue(
  fieldName: string,
  context: HealthCheckDiagramSlotContext
): unknown {
  if (context.type === "raw") {
    const runs = context.runs;
    if (runs.length === 0) return undefined;
    // Strategy-specific fields are in result.metadata, not result directly
    const result = runs.at(-1)?.result as Record<string, unknown> | undefined;
    const metadata = result?.metadata as Record<string, unknown> | undefined;
    return getFieldValue(metadata, fieldName);
  } else {
    const buckets = context.buckets;
    if (buckets.length === 0) return undefined;
    return getFieldValue(
      buckets.at(-1)?.aggregatedResult as Record<string, unknown>,
      fieldName
    );
  }
}

/**
 * Get all numeric values for a field from the context.
 *
 * For raw runs, the strategy-specific data is inside result.metadata.
 * For aggregated buckets, the data is directly in aggregatedResult.
 */
function getAllValues(
  fieldName: string,
  context: HealthCheckDiagramSlotContext
): number[] {
  if (context.type === "raw") {
    return context.runs
      .map((run) => {
        const result = run.result as Record<string, unknown>;
        const metadata = result?.metadata as
          | Record<string, unknown>
          | undefined;
        return getFieldValue(metadata, fieldName);
      })
      .filter((v): v is number => typeof v === "number");
  }
  return context.buckets
    .map((bucket) =>
      getFieldValue(
        bucket.aggregatedResult as Record<string, unknown>,
        fieldName
      )
    )
    .filter((v): v is number => typeof v === "number");
}

/**
 * Format a value for text display.
 */
function formatTextValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
