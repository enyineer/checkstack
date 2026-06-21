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
} from "./chart-math";
