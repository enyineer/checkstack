/**
 * AutoChartGrid - the auto-generated metric tile grid.
 *
 * Parses the strategy's aggregated result schema for chart annotations and
 * renders one compact, prioritized `StatTile` per annotated field, grouped by
 * collector instance. Tiles expand in place to a full chart (density by
 * default, depth on demand). All extraction/ordering logic is pure and tested
 * in `tile-model.logic.ts`; this file is rendering only.
 */

import { useState } from "react";
import {
  CategoryRibbon,
  DistributionBar,
  RadialGauge,
  Skeleton,
  StackedTimeline,
  StatTile,
  TimeSeriesChart,
  UptimeRibbon,
  cn,
  type SparklineTone,
} from "@checkstack/ui";
import { AnomalyApi } from "@checkstack/anomaly-common";
import type { AnomalyBaselineDto } from "@checkstack/anomaly-common";
import {
  HealthCheckApi,
  computeAssertionKey,
  type CollectorConfigEntry,
} from "@checkstack/healthcheck-common";
import { usePluginClient } from "@checkstack/frontend-api";
import type { ChartField } from "./schema-parser";
import { extractChartFields } from "./schema-parser";
import { useStrategySchemas } from "./useStrategySchemas";
import type { HealthCheckDiagramSlotContext } from "../slots";
import {
  buildAssertionTileModels,
  buildTileModels,
  formatMetricValue,
  type AssertionTileModel,
  type TileModel,
} from "./tile-model.logic";
import { BaselineChipStack } from "./BaselineChips";
import { labelForAssertionKey } from "../components/assertion-display.logic";

interface AutoChartGridProps {
  context: HealthCheckDiagramSlotContext;
}

/**
 * Main component that renders the prioritized tile grid: strategy-level tiles
 * first, then one group per discovered collector instance.
 */
export function AutoChartGrid({ context }: AutoChartGridProps) {
  const { schemas, loading } = useStrategySchemas(context.strategyId);
  const anomalyClient = usePluginClient(AnomalyApi);
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const { data: baselines = [] } = anomalyClient.getAnomalyBaselines.useQuery({
    systemId: context.systemId,
    configurationId: context.configurationId,
  });
  // The configuration's CURRENT assertions seed the assertion tiles so a
  // freshly-added assertion shows up before any data exists. Readers without
  // configuration access simply get the historical series (retry: false —
  // a 403 is a valid answer, not a transient failure).
  const { data: configurationsData } =
    healthCheckClient.getConfigurations.useQuery({}, { retry: false });
  const configEntries: CollectorConfigEntry[] =
    configurationsData?.configurations.find(
      (c) => c.id === context.configurationId,
    )?.collectors ?? [];
  const configLoaded = configurationsData !== undefined;

  if (loading) {
    return (
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
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

  // Raw (per-run) schema fields carry annotations the aggregated fields
  // don't - e.g. the x-chart-true/false-label prose for boolean dominants.
  const rawFields = extractChartFields(schemas.resultSchema);

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
        <TileGrid
          tiles={buildTileModels({
            fields: strategyFields,
            buckets: context.buckets,
            baselines,
            rawFields,
          })}
        />
      )}

      {/* Collector groups */}
      {collectorGroups.map((group) => (
        <CollectorGroup
          key={group.instanceKey}
          group={group}
          context={context}
          baselines={baselines}
          rawFields={rawFields}
          configEntry={configEntries.find((e) => e.id === group.instanceKey)}
          configLoaded={configLoaded}
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
  fields: ChartField[];
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
        fields: collectorFields,
      });
    }
  }

  return groups;
}

/**
 * A collector-instance section: a soft header (qualified collector id demoted
 * to a hover title) over the instance's tile grid.
 */
function CollectorGroup({
  group,
  context,
  baselines,
  rawFields,
  configEntry,
  configLoaded,
}: {
  group: CollectorGroupData;
  context: HealthCheckDiagramSlotContext;
  baselines: AnomalyBaselineDto[];
  rawFields: ChartField[];
  configEntry?: CollectorConfigEntry;
  configLoaded: boolean;
}) {
  const tiles = buildTileModels({
    fields: group.fields,
    buckets: context.buckets,
    baselines,
    instanceKey: group.instanceKey,
    rawFields,
  });

  // Assertion pass-rate tiles lead the group: real per-assertion counts from
  // the buckets' assertion stats, seeded by the config's current assertions.
  const assertionTiles = buildAssertionTileModels({
    buckets: context.buckets,
    instanceKey: group.instanceKey,
    configuredKeys: configLoaded
      ? (configEntry?.assertions ?? []).map((assertion) =>
          computeAssertionKey({ assertion }),
        )
      : undefined,
    labelForKey: labelForAssertionKey,
  });

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-baseline gap-2 border-b border-border/60 pb-2"
        title={`${group.collectorId} · ${group.instanceKey}`}
      >
        <h3 className="text-sm font-medium capitalize">{group.displayName}</h3>
        {group.instanceLabel && (
          <span className="text-xs text-muted-foreground">
            {group.instanceLabel}
          </span>
        )}
      </div>
      <TileGrid
        tiles={tiles}
        assertionTiles={assertionTiles}
        hoverTitlePrefix={`${group.collectorId} · ${group.instanceKey}`}
      />
    </div>
  );
}

/**
 * The 2-up (desktop) / 1-up (mobile) tile grid with single-tile expansion; an
 * expanded tile spans the full row.
 */
function TileGrid({
  tiles,
  assertionTiles = [],
  hoverTitlePrefix,
}: {
  tiles: TileModel[];
  assertionTiles?: AssertionTileModel[];
  hoverTitlePrefix?: string;
}) {
  const [expandedKey, setExpandedKey] = useState<string | undefined>();

  if (tiles.length === 0 && assertionTiles.length === 0) return <></>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {assertionTiles.map((tile) => {
        const expanded = expandedKey === tile.key;
        const hasData = tile.totalPass + tile.totalFail > 0;
        return (
          <AssertionTile
            key={tile.key}
            tile={tile}
            expanded={expanded}
            onToggleExpand={
              hasData
                ? () => setExpandedKey(expanded ? undefined : tile.key)
                : undefined
            }
            className={cn(expanded && "sm:col-span-2")}
          />
        );
      })}
      {tiles.map((tile) => {
        const expanded = expandedKey === tile.key;
        return (
          <AutoTile
            key={tile.key}
            tile={tile}
            hoverTitle={
              hoverTitlePrefix === undefined
                ? tile.fieldName
                : `${hoverTitlePrefix} · ${tile.fieldName}`
            }
            expanded={expanded}
            onToggleExpand={
              tile.expandable
                ? () => setExpandedKey(expanded ? undefined : tile.key)
                : undefined
            }
            className={cn(expanded && "sm:col-span-2")}
          />
        );
      })}
    </div>
  );
}

const assertionSparkTone: Record<string, SparklineTone> = {
  ok: "ok",
  warn: "warn",
  down: "down",
  default: "muted",
  unknown: "muted",
};

/** One assertion series: pass-rate summary, expandable to pass/fail bars. */
function AssertionTile({
  tile,
  expanded,
  onToggleExpand,
  className,
}: {
  tile: AssertionTileModel;
  expanded: boolean;
  onToggleExpand?: () => void;
  className?: string;
}) {
  const hasSpark = tile.sparkValues.some((v) => v !== null);
  return (
    <StatTile
      label={`Assertion: ${tile.label}`}
      value={tile.latestText}
      tone={tile.tone}
      sparkline={
        hasSpark
          ? {
              values: tile.sparkValues,
              tone: assertionSparkTone[tile.tone] ?? "muted",
              ariaLabel: `Pass rate of ${tile.label} over the loaded window`,
            }
          : undefined
      }
      hoverTitle={
        tile.configured === false
          ? `${tile.label} — no longer configured`
          : tile.label
      }
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      className={className}
    >
      <div className="space-y-2">
        <StackedTimeline
          buckets={tile.stacked}
          height={72}
          toneLabels={{ ok: "Passed", down: "Failed" }}
          ariaLabel={`Pass/fail counts of ${tile.label} over the loaded window`}
        />
        {tile.configured === false && (
          <p className="text-xs text-muted-foreground">
            No longer configured — historical data only.
          </p>
        )}
      </div>
    </StatTile>
  );
}

/** One tile: the StatTile summary plus its kind-specific expanded chart. */
function AutoTile({
  tile,
  hoverTitle,
  expanded,
  onToggleExpand,
  className,
}: {
  tile: TileModel;
  hoverTitle: string;
  expanded: boolean;
  onToggleExpand?: () => void;
  className?: string;
}) {
  const sparkline =
    tile.sparkValues !== undefined && tile.sparkValues.length > 1
      ? {
          values: tile.sparkValues,
          ariaLabel: `${tile.label} over the loaded window`,
        }
      : undefined;

  let footer: React.ReactNode;
  if (tile.kind === "boolean" && tile.boolCells !== undefined) {
    footer = (
      <UptimeRibbon
        cells={tile.boolCells}
        height={10}
        gap={1}
        className="w-full"
      />
    );
  } else if (tile.kind === "category" && tile.categoryCells !== undefined) {
    footer = (
      <CategoryRibbon
        cells={tile.categoryCells}
        height={10}
        className="w-full"
      />
    );
  }

  return (
    <StatTile
      label={tile.label}
      value={tile.latestText}
      tone={tile.tone === "default" ? "default" : tile.tone}
      delta={tile.delta}
      sparkline={footer === undefined ? sparkline : undefined}
      footer={footer}
      hoverTitle={hoverTitle}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      className={className}
    >
      <ExpandedTileBody tile={tile} />
    </StatTile>
  );
}

/** The expanded body for an expandable tile, by kind. */
function ExpandedTileBody({ tile }: { tile: TileModel }) {
  switch (tile.kind) {
    case "number": {
      if (tile.series === undefined) return <></>;
      return (
        <div className="space-y-2">
          {tile.baselineChips && (
            <div className="flex justify-end">
              <BaselineChipStack chips={tile.baselineChips} />
            </div>
          )}
          <TimeSeriesChart
            primary={{
              id: tile.key,
              label: tile.label,
              points: tile.series,
            }}
            healthyBand={
              tile.expectedBand === undefined
                ? undefined
                : { from: tile.expectedBand.from, to: tile.expectedBand.to }
            }
            referenceLine={
              tile.expectedBand === undefined
                ? undefined
                : {
                    value: tile.expectedBand.to,
                    label: "Expected max",
                    tone: "warn",
                  }
            }
            height={160}
            formatY={(v) => formatMetricValue({ value: v, unit: tile.unit })}
            ariaLabel={`${tile.label} over the loaded window`}
          />
        </div>
      );
    }
    case "gauge": {
      // The expected/trend chips render BELOW the gauge, not as its caption:
      // a long chip ("Usually successful (98%)") collides with the arc feet
      // in the caption slot, which is sized for short hero captions.
      const gaugeToneClass: Record<string, string> = {
        ok: "text-[hsl(var(--status-ok))]",
        warn: "text-[hsl(var(--status-warn))]",
        down: "text-[hsl(var(--status-down))]",
      };
      return (
        <div className="flex flex-col items-center gap-1.5">
          <RadialGauge
            value={tile.gaugeFraction ?? 0}
            displayValue={tile.latestText}
            variant="quiet"
            width={180}
          />
          {tile.baselineChips?.expected && (
            <span
              className={cn(
                "px-2 text-center text-xs font-semibold tracking-wide",
                gaugeToneClass[tile.tone] ?? "text-muted-foreground",
              )}
            >
              {tile.baselineChips.expected}
            </span>
          )}
          {tile.baselineChips?.trend && (
            <span
              className={
                tile.baselineChips.trend.drifting
                  ? "text-xs font-medium text-[hsl(var(--status-warn))]"
                  : "text-xs text-muted-foreground"
              }
            >
              {tile.baselineChips.trend.text}
            </span>
          )}
        </div>
      );
    }
    case "distribution": {
      if (tile.slices === undefined) return <></>;
      return (
        <DistributionBar
          slices={tile.slices}
          ariaLabel={`${tile.label} distribution over the loaded window`}
        />
      );
    }
    case "boolean": {
      if (tile.boolCells === undefined) return <></>;
      return (
        <div className="space-y-2">
          <UptimeRibbon cells={tile.boolCells} height={20} gap={2} />
          {tile.dominantChip && (
            <p className="text-xs text-muted-foreground">{tile.dominantChip}</p>
          )}
        </div>
      );
    }
    case "category": {
      if (tile.categoryCells === undefined) return <></>;
      return (
        <div className="space-y-2">
          <CategoryRibbon cells={tile.categoryCells} height={20} gap={2} />
          {tile.dominantChip && (
            <p className="text-xs text-muted-foreground">{tile.dominantChip}</p>
          )}
        </div>
      );
    }
    default: {
      return <></>;
    }
  }
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
