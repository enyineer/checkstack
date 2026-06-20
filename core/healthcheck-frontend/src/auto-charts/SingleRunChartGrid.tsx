/**
 * SingleRunChartGrid - Renders auto-generated charts for a single health check run.
 *
 * Unlike AutoChartGrid which shows time series data, this component displays
 * static values from a single run's result/metadata.
 */

import type { ChartField } from "./schema-parser";
import { extractChartFields, getFieldValue } from "./schema-parser";
import { useStrategySchemas } from "./useStrategySchemas";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  RadialGauge,
  type GaugeCaptionTone,
} from "@checkstack/ui";

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
        <div className="space-y-4">
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
  const collectorError = data._collectorError as string | undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap border-b pb-2">
        <h3 className="text-lg font-semibold capitalize">{displayName}</h3>
        <Badge variant="outline" className="font-mono">
          {collectorId}
        </Badge>
        <span className="text-xs text-muted-foreground font-mono">
          {instanceId.slice(0, 8)}
        </span>
      </div>

      {/* Assertion status if present */}
      {assertionFailed && (
        <Card className="border-status-down/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-status-down">
              Assertion Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-status-down bg-status-down/10 px-2 py-1 rounded">
              {assertionFailed}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Collector execution error if present */}
      {collectorError && (
        <Card className="border-status-down/40 border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-status-down">
              Collector Execution Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-status-down bg-status-down/10 px-2 py-1 rounded">
              {collectorError}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
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
        <CardTitle className="text-sm font-medium text-center">
          {field.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center text-center [&>*]:w-full">
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

  // Tone follows value (higher is better for rate-style gauges).
  const captionTone: GaugeCaptionTone =
    clampedValue >= 90 ? "ok" : clampedValue >= 70 ? "warn" : "down";

  return (
    <div className="flex items-center justify-center">
      <RadialGauge
        variant="quiet"
        width={140}
        value={clampedValue / 100}
        displayValue={`${clampedValue.toFixed(1)}${displayUnit}`}
        captionTone={captionTone}
        ariaLabel={`${clampedValue.toFixed(1)}${displayUnit}`}
      />
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
    <div className="flex items-center justify-center gap-2">
      <div
        className={`w-3 h-3 rounded-full ${
          boolValue ? "bg-status-ok" : "bg-status-down"
        }`}
      />
      <span className={boolValue ? "text-status-ok" : "text-status-down"}>
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
    <div className="text-sm text-status-down bg-status-down/10 px-2 py-1 rounded truncate">
      {String(value)}
    </div>
  );
}
