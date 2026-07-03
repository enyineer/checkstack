/**
 * SingleRunChartGrid - Renders auto-generated value tiles for a single health
 * check run.
 *
 * Unlike AutoChartGrid which shows time series data, this component displays
 * static values from a single run's result/metadata, in the same compact
 * left-aligned tile grid as the timeline view.
 */

import type { ChartField } from "./schema-parser";
import { extractChartFields, getFieldValue } from "./schema-parser";
import { useStrategySchemas } from "./useStrategySchemas";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  RadialGauge,
  StatTile,
  type StatTileProps,
} from "@checkstack/ui";
import { formatMetricValue, gaugeTone } from "./tile-model.logic";

interface SingleRunChartGridProps {
  /** Strategy ID (qualified, e.g., "healthcheck-http-backend.http") */
  strategyId: string;
  /** The run's result data containing metadata */
  result: Record<string, unknown>;
}

/**
 * Main component that renders a grid of value tiles for a single run.
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {strategyFields
            .toSorted((a, b) => a.priority - b.priority)
            .map((field) => (
              <SingleValueTile
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
 * Section for a single collector instance. The qualified collector id and the
 * instance uuid are demoted to a hover title on the header.
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
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-baseline gap-2 border-b border-border/60 pb-2"
        title={`${collectorId} · ${instanceId}`}
      >
        <h3 className="text-sm font-medium capitalize">{displayName}</h3>
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields
          .toSorted((a, b) => a.priority - b.priority)
          .map((field) => (
            <SingleValueTile
              key={field.name}
              field={field}
              value={getFieldValue(data, field.name)}
            />
          ))}
      </div>
    </div>
  );
}

interface SingleValueTileProps {
  field: ChartField;
  value: unknown;
}

/**
 * One field's value as a compact tile. Gauges keep the quiet RadialGauge;
 * everything else is a number-led StatTile.
 */
function SingleValueTile({ field, value }: SingleValueTileProps) {
  if (field.chartType === "gauge") {
    const numValue = typeof value === "number" ? value : Number(value);
    if (!Number.isNaN(numValue) && value !== undefined && value !== null) {
      const clamped = Math.min(100, Math.max(0, numValue));
      const unit = field.unit ?? "%";
      return (
        <div className="rounded-[var(--d-card-r)] border border-border/70 bg-card p-3">
          <span className="block truncate text-xs text-muted-foreground">
            {field.label}
          </span>
          <div className="mt-1 flex justify-center">
            <RadialGauge
              variant="quiet"
              width={140}
              value={clamped / 100}
              displayValue={formatMetricValue({ value: clamped, unit })}
              captionTone={mapTone(
                gaugeTone({ value: clamped, goodDirection: field.goodDirection }),
              )}
              ariaLabel={`${field.label}: ${formatMetricValue({ value: clamped, unit })}`}
            />
          </div>
        </div>
      );
    }
  }

  const { text, tone } = formatSingleValue({ field, value });
  return (
    <StatTile
      label={field.label}
      value={text}
      tone={tone}
      hoverTitle={typeof value === "string" ? value : undefined}
    />
  );
}

function mapTone(
  tone: "ok" | "warn" | "down" | "unknown" | "default",
): "ok" | "warn" | "down" | "muted" {
  return tone === "unknown" || tone === "default" ? "muted" : tone;
}

/** Format a single run value per chart type, with a status tone. */
function formatSingleValue({
  field,
  value,
}: {
  field: ChartField;
  value: unknown;
}): { text: string; tone: StatTileProps["tone"] } {
  if (value === undefined || value === null || value === "") {
    return field.chartType === "status"
      ? { text: "No errors", tone: "default" }
      : { text: "—", tone: "default" };
  }

  switch (field.chartType) {
    case "line":
    case "counter":
    case "gauge": {
      const numValue = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(numValue)) {
        return { text: String(value), tone: "default" };
      }
      return {
        text: formatMetricValue({ value: numValue, unit: field.unit ?? "" }),
        tone: "default",
      };
    }
    case "boolean": {
      const boolValue = Boolean(value);
      return {
        text: boolValue ? "Yes" : "No",
        tone: boolValue ? "ok" : "down",
      };
    }
    case "status": {
      return { text: String(value), tone: "down" };
    }
    default: {
      return { text: String(value), tone: "default" };
    }
  }
}
