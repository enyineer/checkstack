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
 * Metadata type for health check result schemas.
 * Provides autocompletion for chart-related metadata on result fields.
 */
export interface HealthResultMeta {
  /** The type of chart to render for this field */
  "x-chart-type"?: ChartType;
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
}
