/**
 * Chart types for auto-generated health check visualizations.
 *
 * Numeric types:
 * - line: Time series line chart for numeric metrics over time
 * - bar: Bar chart for distributions (record of string to number)
 * - counter: Simple count display with trend indicator
 * - gauge: Percentage gauge for rates/percentages (0-100)
 *
 * Non-numeric types:
 * - boolean: Boolean indicator (success/failure, connected/disconnected)
 * - text: Text display for string values
 * - status: Status badge for error/warning states
 */
export type ChartType =
  | "line"
  | "bar"
  | "pie"
  | "counter"
  | "gauge"
  | "boolean"
  | "text"
  | "status";

/**
 * Base metadata for all health check result schema fields.
 */
export interface BaseHealthResultMeta {
  /** Human-readable label for the chart (defaults to field name) */
  "x-chart-label"?: string;
  /** Unit suffix for values (e.g., 'ms', '%', 'req/s') */
  "x-chart-unit"?: string;
  /** Whether this field supports JSONPath assertions */
  "x-jsonpath"?: boolean;
  /**
   * Whether this field is ephemeral (used for assertions but not persisted).
   * Ephemeral fields are stripped before storing results in the database.
   */
  "x-ephemeral"?: boolean;
  /**
   * Sensitivity multiplier for this field (default: 1.0).
   * Higher values = fewer alerts (wider threshold).
   * Lower values = more alerts (tighter threshold).
   * Applied as: threshold = μ ± (3σ × sensitivity)
   */
  "x-anomaly-sensitivity"?: number;
  /**
   * Override the default confirmation window for this field.
   * Number of consecutive anomalous data points required before an alert is raised.
   */
  "x-anomaly-confirmation-window"?: number;
  /**
   * Enable trend drift detection for this field. Default true (when anomaly
   * detection is enabled). Set false to suppress drift alerts but keep spike
   * detection active.
   */
  "x-anomaly-drift-enabled"?: boolean;
  /**
   * Sigma multiplier on the drift trigger band (default 2). Drift fires when
   * |slope × sampleCount| > threshold × σ × sensitivity.
   */
  "x-anomaly-drift-threshold"?: number;
}

/**
 * Metadata for a field that exposes a chart AND has anomaly detection enabled.
 */
export interface ChartMetaAnomalyEnabled extends BaseHealthResultMeta {
  "x-chart-type": ChartType;
  "x-anomaly-enabled": true;
  "x-anomaly-direction": "higher-is-better" | "lower-is-better" | "deviation" | "dominance";
}

/**
 * Metadata for a field that exposes a chart but explicitly disables anomaly detection.
 */
export interface ChartMetaAnomalyDisabled extends BaseHealthResultMeta {
  "x-chart-type": ChartType;
  "x-anomaly-enabled": false;
  "x-anomaly-direction"?: never;
}

/**
 * Metadata for a field that does NOT expose a chart.
 */
export interface NonChartMeta extends BaseHealthResultMeta {
  "x-chart-type"?: never;
  "x-anomaly-enabled"?: never;
  "x-anomaly-direction"?: never;
}

/**
 * Metadata type for health check result schemas.
 * Provides autocompletion and enforces that ANY field exposing a chart
 * MUST explicitly define its anomaly behavior.
 */
export type HealthResultMeta = 
  | ChartMetaAnomalyEnabled 
  | ChartMetaAnomalyDisabled 
  | NonChartMeta;

