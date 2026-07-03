/**
 * Chart primitives for the UI rework (see `reviews/design/SYNTHESIS-SPEC.md`).
 *
 * Honest, token-driven, light/dark SVG charts: straight-segment lines (no
 * dishonest splines), aurora gradient reserved for the focal series + hero
 * gauge, motion gated behind `usePerformance().isLowPower`.
 *
 * The main `core/ui/src/index.ts` barrel wires this in separately.
 */
export {
  TimeSeriesChart,
  type TimeSeriesChartProps,
  type TimeSeries,
  type HealthyBand,
  type ReferenceLineSpec,
} from "./TimeSeriesChart";
export { Sparkline, type SparklineProps, type SparklineTone } from "./Sparkline";
export {
  RadialGauge,
  type RadialGaugeProps,
  type GaugeCaptionTone,
} from "./RadialGauge";
export {
  RequestWaterfall,
  type RequestWaterfallProps,
} from "./RequestWaterfall";
export { UptimeRibbon, type UptimeRibbonProps } from "./UptimeRibbon";
export {
  ChartTooltip,
  type ChartTooltipProps,
  type ChartTooltipRow,
  type ChartTooltipTone,
} from "./ChartTooltip";
export {
  ChartCard,
  chartCardChromeClass,
  type ChartCardProps,
} from "./ChartCard";
export {
  StackedTimeline,
  type StackedTimelineProps,
  type StackedTimelineTooltipContent,
} from "./StackedTimeline";
export { useBandHover, type UseBandHoverResult } from "./use-band-hover";
export {
  StatTile,
  type StatTileProps,
  type StatTileDelta,
  type StatTileTone,
} from "./StatTile";
export {
  DistributionBar,
  type DistributionBarProps,
} from "./DistributionBar";
export {
  CategoryRibbon,
  type CategoryRibbonProps,
} from "./CategoryRibbon";

// Shared, framework-free math + types (handy for callers building data).
export {
  extentOf,
  padRange,
  scaleLinear,
  projectSeries,
  toPolylineSegments,
  toAreaPaths,
  layoutWaterfall,
  summarizeRibbon,
  clampFraction,
  semicircleGauge,
  downsampleStacked,
  stackFractions,
  pickTickFormat,
  bandIndexAtX,
  pointIndexAtX,
  nearestIndexByFraction,
  layoutDistribution,
  summarizeCategories,
  computeDelta,
  deltaSentiment,
  DISTRIBUTION_OTHER_ID,
  type SeriesPoint,
  type Range,
  type PlotBox,
  type WaterfallPhase,
  type LaidOutPhase,
  type WaterfallLayout,
  type RibbonStatus,
  type RibbonCell,
  type RibbonSummary,
  type GaugeArc,
  type StackTone,
  type StackedBucket,
  type StackedBar,
  type DistributionSlice,
  type LaidOutDistributionSlice,
  type CategoryCell,
  type DeltaDirection,
} from "./chart-math";
