/**
 * Auto-chart components for rendering schema-driven visualizations.
 *
 * These components render charts based on x-chart-type metadata in JSON schemas,
 * eliminating the need for custom chart components for standard metrics.
 */

export { extractChartFields, getFieldValue } from "./schema-parser";
export type { ChartField, ChartType } from "./schema-parser";
export { AutoChartGrid } from "./AutoChartGrid";
export { useStrategySchemas } from "./useStrategySchemas";
export { autoChartExtension } from "./extension";
