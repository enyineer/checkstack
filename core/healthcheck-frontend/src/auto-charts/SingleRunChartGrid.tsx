/**
 * SingleRunChartGrid - Renders auto-generated charts for a single health check run.
 *
 * Unlike AutoChartGrid which shows time series data, this component displays
 * static values from a single run's result/metadata.
 */

import type { ChartField } from "./schema-parser";
import { extractChartFields, getFieldValue } from "./schema-parser";
import { useStrategySchemas } from "./useStrategySchemas";
import { Card, CardContent, CardHeader, CardTitle } from "@checkstack/ui";
import { RadialBarChart, RadialBar, ResponsiveContainer } from "recharts";

interface SingleRunChartGridProps {
  /** Strategy ID (qualified, e.g., "healthcheck-http-backend.http") */
  strategyId: string;
  /** The run's result data containing metadata */
  result: Record<string, unknown>;
}

/**
 * Main component that renders a grid of charts for a single run.
 */
export function SingleRunChartGrid({
  strategyId,
  result,
}: SingleRunChartGridProps) {
  const { schemas, loading } = useStrategySchemas(strategyId);

  if (loading) {
    return;
  }

  if (!schemas) {
    return;
  }

  // Use result schema for per-run data
  const schema = schemas.resultSchema;

  const schemaFields = extractChartFields(schema);
  if (schemaFields.length === 0) {
    return;
  }

  // Get the metadata from the result
  const metadata = result.metadata as Record<string, unknown> | undefined;
  if (!metadata) {
    return;
  }

  // Discover collector instances from result data
  const collectors = metadata.collectors as
    | Record<string, Record<string, unknown>>
    | undefined;
  const collectorEntries = collectors ? Object.entries(collectors) : [];

  // Separate strategy-level fields from collector fields
  const strategyFields = schemaFields.filter((f) => !f.collectorId);

  return (
    <div className="space-y-6">
      {/* Strategy-level fields */}
      {strategyFields.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {strategyFields.map((field) => (
            <SingleValueCard
              key={field.name}
              field={field}
              value={getFieldValue(metadata, field.name)}
            />
          ))}
        </div>
      )}

      {/* Collector groups */}
      {collectorEntries
        .filter(([, collectorData]) => {
          const collectorId = collectorData._collectorId as string | undefined;
          if (!collectorId) return false;
          const collectorFields = schemaFields.filter(
            (f) => f.collectorId === collectorId,
          );
          return collectorFields.length > 0;
        })
        .map(([instanceId, collectorData]) => {
          const collectorId = collectorData._collectorId as string;
          const collectorFields = schemaFields.filter(
            (f) => f.collectorId === collectorId,
          );
          return (
            <CollectorSection
              key={instanceId}
              instanceId={instanceId}
              collectorId={collectorId}
              fields={collectorFields}
              data={collectorData}
            />
          );
        })}
    </div>
  );
}

interface CollectorSectionProps {
  instanceId: string;
  collectorId: string;
  fields: ChartField[];
  data: Record<string, unknown>;
}

/**
 * Section for a single collector instance.
 */
function CollectorSection({
  instanceId,
  collectorId,
  fields,
  data,
}: CollectorSectionProps) {
  const displayName = collectorId.split(".").pop() || collectorId;
  const assertionFailed = data._assertionFailed as string | undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {displayName}
        </h4>
        <span className="text-xs text-muted-foreground">
          ({instanceId.slice(0, 8)})
        </span>
      </div>

      {/* Assertion status if present */}
      {assertionFailed && (
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
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <SingleValueCard
            key={field.name}
            field={field}
            value={getFieldValue(data, field.name)}
          />
        ))}
      </div>
    </div>
  );
}

interface SingleValueCardProps {
  field: ChartField;
  value: unknown;
}

/**
 * Card displaying a single value based on its chart type.
 */
function SingleValueCard({ field, value }: SingleValueCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{field.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <SingleValueRenderer field={field} value={value} />
      </CardContent>
    </Card>
  );
}

interface SingleValueRendererProps {
  field: ChartField;
  value: unknown;
}

/**
 * Dispatches to appropriate renderer based on chart type.
 */
function SingleValueRenderer({ field, value }: SingleValueRendererProps) {
  switch (field.chartType) {
    case "line":
    case "counter": {
      return <NumberRenderer value={value} unit={field.unit} />;
    }
    case "gauge": {
      return <GaugeRenderer value={value} unit={field.unit} />;
    }
    case "boolean": {
      return <BooleanRenderer value={value} />;
    }
    case "text": {
      return <TextRenderer value={value} />;
    }
    case "status": {
      return <StatusRenderer value={value} />;
    }
    case "bar":
    case "pie": {
      // For bar/pie, just show the value since we can't do distributions with a single point
      return <TextRenderer value={value} />;
    }
    default: {
      return <TextRenderer value={value} />;
    }
  }
}

/**
 * Renders a numeric value with optional unit.
 */
function NumberRenderer({ value, unit }: { value: unknown; unit?: string }) {
  if (value === undefined || value === null) {
    return <div className="text-muted-foreground">—</div>;
  }

  const numValue = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numValue)) {
    return <div className="text-muted-foreground">{String(value)}</div>;
  }

  const formatted = Number.isInteger(numValue)
    ? String(numValue)
    : numValue.toFixed(2);

  return (
    <div className="text-2xl font-bold">
      {formatted}
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
function GaugeRenderer({ value, unit }: { value: unknown; unit?: string }) {
  if (value === undefined || value === null) {
    return <div className="text-muted-foreground">—</div>;
  }

  const numValue = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numValue)) {
    return <div className="text-muted-foreground">{String(value)}</div>;
  }

  const clampedValue = Math.min(100, Math.max(0, numValue));
  const displayUnit = unit ?? "%";

  // Determine color based on value
  const fillColor =
    clampedValue >= 90
      ? "hsl(var(--success))"
      : clampedValue >= 70
        ? "hsl(var(--warning))"
        : "hsl(var(--destructive))";

  const data = [{ name: "value", value: clampedValue, fill: fillColor }];

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
        {clampedValue.toFixed(1)}
        {displayUnit}
      </div>
    </div>
  );
}

/**
 * Renders a boolean indicator.
 */
function BooleanRenderer({ value }: { value: unknown }) {
  if (value === undefined || value === null) {
    return <div className="text-muted-foreground">—</div>;
  }

  const boolValue = Boolean(value);

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-3 h-3 rounded-full ${
          boolValue ? "bg-green-500" : "bg-red-500"
        }`}
      />
      <span className={boolValue ? "text-green-600" : "text-red-600"}>
        {boolValue ? "Yes" : "No"}
      </span>
    </div>
  );
}

/**
 * Renders a text value.
 */
function TextRenderer({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === "") {
    return <div className="text-muted-foreground">—</div>;
  }

  const strValue = String(value);

  return (
    <div className="text-sm font-mono truncate" title={strValue}>
      {strValue}
    </div>
  );
}

/**
 * Renders an error/status badge.
 */
function StatusRenderer({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === "") {
    return <div className="text-sm text-muted-foreground">No errors</div>;
  }

  return (
    <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950 px-2 py-1 rounded truncate">
      {String(value)}
    </div>
  );
}
