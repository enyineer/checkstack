---
title: "Health check charts"
description: "The auto-generated metric tile grid, the @checkstack/ui chart primitives, and the diagram slot for strategy-specific health check visualizations."
---

Health check charts are generated automatically from the chart annotations on a strategy or collector result schema, and rendered with the shared chart kit in `@checkstack/ui`. This page covers the auto tile grid the platform builds for every check, the primitives you can reuse, and the diagram slot for shipping a strategy-specific visualization.

> [!NOTE]
> The earlier Recharts-based auto-chart renderers have been removed. All health check visualizations now render through the token-driven SVG primitives in `@checkstack/ui`. If you maintained a custom diagram that imported `recharts`, migrate it to those primitives.

## The auto tile grid

Every check gets an auto-generated visualization with no per-strategy code: `AutoChartGrid` reads the strategy's aggregated result schema, extracts the chart annotations (`x-chart-*`), and renders one compact tile per annotated field. Fields are grouped by collector instance, and each group is a prioritized two-up grid (single column on mobile).

- **Ordering.** Tiles sort by the field's `x-chart-priority` (lower renders first, default `100`), so a headline metric leads its group without every field needing a weight. See the [chart metadata keys](/checkstack/developer-guide/backend/healthchecks/collectors/#chart-metadata-keys) for the annotation contract.
- **Density first, depth on demand.** Each tile is a `StatTile`: a muted label over a bold `tabular-nums` value, with a word-sized sparkline (numeric) or a ribbon footer (boolean/categorical). Clicking a tile expands it in place to a full chart that spans the row - a `TimeSeriesChart` with the anomaly Expected band for numeric metrics, a `RadialGauge` for gauges, a `DistributionBar` for distributions, or an `UptimeRibbon` / `CategoryRibbon` for boolean and categorical history.
- **Assertion tiles lead each group.** Before the metric tiles, each collector group renders one pass-rate tile per configured assertion (see [Assertion tiles](#assertion-tiles) below).
- **Collector identity.** The qualified collector id (for example `collector-hardware-backend.cpu`) is demoted to a hover title on the group header and tiles; the group heading shows the clean collector name.

You do not call `AutoChartGrid` directly - the drawer and the history detail view render it for you from a `HealthCheckDiagramSlotContext`.

## The `@checkstack/ui` chart primitives

The chart kit is exported from `@checkstack/ui`. Build any custom diagram on these rather than pulling in a charting library; they are honest (straight-segment lines, no dishonest splines), token-driven for light/dark, and gate motion behind `usePerformance().isLowPower`.

| Primitive | Use for |
|-----------|---------|
| `TimeSeriesChart` | A numeric metric over time, with an optional healthy band, reference line, and a hover tooltip (`useBandHover` + `ChartTooltip`). |
| `Sparkline` | A word-sized inline trend, with a `tone`. |
| `RadialGauge` | A single 0-1 fraction (rates, percentages) as a semicircle gauge. |
| `StackedTimeline` | Stacked status counts per bucket (healthy/degraded/unhealthy), status-triad tokens. |
| `UptimeRibbon` | A per-cell status history strip (boolean up/down). |
| `CategoryRibbon` | A categorical history strip - a changed value shows in the warn tone. |
| `DistributionBar` | A horizontal stacked distribution with a legend. |
| `RequestWaterfall` | Per-phase request timings (DNS, connect, TLS, ...). |
| `StatTile` | A metric tile: label, value, delta chip, sparkline/ribbon footer, click-to-expand disclosure. |
| `ChartCard` | Premium card chrome (`chartCardChromeClass`) with an `isLowPower` fallback. |
| `ChartTooltip` | The single shared chart tooltip. |

All are presentational and framework-free at the math layer (the `chart-math` helpers are exported too, handy when you shape your own data).

### Example: a distribution over buckets

```tsx
import { DistributionBar, type DistributionSlice } from "@checkstack/ui";
import type { HealthCheckDiagramSlotContext } from "@checkstack/healthcheck-frontend";

export function HttpStatusDistribution({
  buckets,
}: HealthCheckDiagramSlotContext<{ statusCodeDistribution?: Record<string, number> }>) {
  const totals: Record<string, number> = {};
  for (const bucket of buckets) {
    const dist = bucket.aggregatedResult?.statusCodeDistribution ?? {};
    for (const [code, count] of Object.entries(dist)) {
      totals[code] = (totals[code] ?? 0) + count;
    }
  }

  const slices: DistributionSlice[] = Object.entries(totals).map(
    ([code, value]) => ({ id: code, label: code, value }),
  );

  return (
    <DistributionBar
      slices={slices}
      ariaLabel="HTTP status code distribution over the loaded window"
    />
  );
}
```

## The diagram slot

For a visualization that goes beyond the auto tile grid, contribute to the `HealthCheckDiagramSlot`. The context always carries aggregated bucket data - the platform's cross-tier aggregation engine picks the right tier (raw, hourly, or daily) and re-aggregates to a fixed number of target points, so a diagram renders identically across time ranges.

```ts
interface HealthCheckDiagramSlotContext<TAggregatedResult = unknown> {
  systemId: string;
  configurationId: string;
  strategyId: string;
  buckets: TypedAggregatedBucket<TAggregatedResult>[];
}
```

Each bucket is an `AggregatedBucket` with a typed `aggregatedResult`:

```ts
interface AggregatedBucketBase {
  bucketStart: Date;
  bucketEnd: Date;
  bucketIntervalSeconds: number;
  runCount: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  successRate: number;
  avgLatencyMs?: number;
  minLatencyMs?: number;
  maxLatencyMs?: number;
  p95LatencyMs?: number;
}

type TypedAggregatedBucket<TAggregatedResult> = AggregatedBucketBase & {
  aggregatedResult?: TAggregatedResult;
};
```

> [!NOTE]
> The context is aggregated-only. There is no separate raw-mode component: shape your diagram to read `buckets`, and it works for every time range. `aggregatedResult` is dropped from very old daily rollups, so always guard it with `?.`.

### Register a diagram extension

Create a pre-typed helper once in your strategy's common package, then register a single aggregated component in the frontend package.

```ts
// @checkstack/healthcheck-http-common/src/slots.ts
import { createDiagramExtensionFactory } from "@checkstack/healthcheck-frontend";
import { httpCheckMetadata } from "./plugin-metadata";
import type { HttpAggregatedResult } from "./types";

export const createHttpDiagramExtension =
  createDiagramExtensionFactory<HttpAggregatedResult>(httpCheckMetadata);
```

```tsx
// @checkstack/healthcheck-http-frontend/src/index.tsx
import { createFrontendPlugin } from "@checkstack/frontend-api";
import { createHttpDiagramExtension } from "@checkstack/healthcheck-http-common";
import { HttpStatusDistribution } from "./charts/HttpStatusDistribution";

const httpStatusDiagram = createHttpDiagramExtension({
  id: "http-check.status-distribution",
  component: HttpStatusDistribution,
});

export default createFrontendPlugin({
  name: "healthcheck-http-frontend",
  extensions: [httpStatusDiagram],
});
```

The factory only renders the component when `ctx.strategyId` matches the strategy metadata, so an extension never leaks into another strategy's charts.

### Accessing the data directly

For a bespoke surface outside the slot, `useHealthCheckData` from `@checkstack/healthcheck-frontend` returns a ready-to-use context plus loading and access state.

```tsx
import { useHealthCheckData } from "@checkstack/healthcheck-frontend";

function MyVisualization({ systemId, configurationId, strategyId, dateRange }) {
  const { context, loading, hasAccess } = useHealthCheckData({
    systemId,
    configurationId,
    strategyId,
    dateRange,
  });

  if (loading) return <Skeleton variant="card" />;
  if (!hasAccess) return <NoAccessBanner />;
  if (!context) return null;

  return <MyChart buckets={context.buckets} />;
}
```

## Assertion tiles

Every collector group in the auto grid leads with a pass-rate tile per configured assertion. Each tile is a `StatTile` whose value is the latest pass rate and whose sparkline is the pass rate over the loaded window; expanding it reveals a `StackedTimeline` of pass/fail counts per bucket.

The tiles are seeded from the configuration's **current** assertions (so a freshly-added assertion appears before any data exists) and matched to historical series by the canonical assertion key. A series whose configuring assertion was edited away still renders, flagged "No longer configured - historical data only". The per-assertion counts come from the aggregate buckets' assertion stats; see [Assertion outcomes and analytics](/checkstack/developer-guide/backend/healthchecks/collectors/#assertion-outcomes-and-analytics) for the backend contract.

For the per-run view (pass/fail rows with expected vs actual), see the Assertions tab documented in [the master-detail pattern](/checkstack/developer-guide/frontend/master-detail/), which the health check history page uses as its reference implementation.

## Next steps

- [Collector plugin development](/checkstack/developer-guide/backend/healthchecks/collectors/) - the chart metadata and assertion contracts.
- [Health check data management](/checkstack/developer-guide/backend/healthchecks/data-management/) - the tiered storage and aggregation the buckets come from.
- [Master-detail pattern](/checkstack/developer-guide/frontend/master-detail/) - the run history split view and `RunDetailPanel`.
- [Extension points](/checkstack/developer-guide/frontend/extension-points/) - the general slot system.
</content>
</invoke>
