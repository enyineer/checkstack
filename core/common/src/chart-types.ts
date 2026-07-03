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
 * Numeric anomaly directions — these operate on a μ ± Nσ statistical band
 * over a continuous metric, so practical-significance floors apply.
 */
export type NumericAnomalyDirection =
  | "higher-is-better"
  | "lower-is-better"
  | "deviation";

/** Categorical anomaly direction — fires on dominance flips, no σ band. */
export type CategoricalAnomalyDirection = "dominance";

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
  /**
   * Sort weight for this field's tile in auto-generated chart grids; lower
   * renders earlier. Fields without a priority default to 100, so a headline
   * metric (e.g. `responseTime: 10`) leads without every field needing one.
   */
  "x-chart-priority"?: number;
  /**
   * Which direction of change is an IMPROVEMENT for this metric, used to color
   * trend indicators (e.g. `"down"` for latency, `"up"` for a success rate).
   * When unset, consumers fall back to `x-anomaly-direction`
   * (`higher-is-better` → `"up"`, `lower-is-better` → `"down"`); metrics with
   * neither render neutral trends.
   */
  "x-chart-good-direction"?: "up" | "down";
  /**
   * Human label rendered where this BOOLEAN field's `true` value surfaces in
   * prose (e.g. `"successful"` for an HTTP `success` field, so a dominance
   * chip reads "Usually successful (98%)" instead of "Usually true"). When
   * unset, consumers fall back to a humanized form of the field name.
   */
  "x-chart-true-label"?: string;
  /** Counterpart of `x-chart-true-label` for `false` (e.g. `"failing"`). */
  "x-chart-false-label"?: string;
}

/**
 * Metadata for a chartable field with numeric anomaly detection.
 * Carries the practical-significance floors (`x-anomaly-min-*-delta`)
 * because they only make sense against a μ ± Nσ band.
 */
export interface ChartMetaAnomalyNumeric extends BaseHealthResultMeta {
  "x-chart-type": ChartType;
  "x-anomaly-enabled": true;
  "x-anomaly-direction": NumericAnomalyDirection;
  /**
   * Practical-significance floor on absolute deviation. Default 0 (disabled).
   * An anomaly only fires when |value − μ| ≥ this floor — even if the
   * statistical trigger (μ ± Nσ) is exceeded. Use to suppress alerts on
   * statistically-unusual but operationally-irrelevant swings on
   * low-baseline metrics (e.g. 6 ms → 20 ms latency).
   * Same field unit as the metric itself.
   */
  "x-anomaly-min-absolute-delta"?: number;
  /**
   * Practical-significance floor on relative deviation. Default 0 (disabled).
   * An anomaly only fires when |value − μ| / max(|μ|, ε) ≥ this floor — even
   * if the statistical trigger is exceeded. Expressed as a fraction
   * (e.g. 0.5 = 50%). Use to suppress alerts whose proportional change is
   * small on high-magnitude metrics.
   */
  "x-anomaly-min-relative-delta"?: number;
}

/**
 * Metadata for a chartable field with categorical (dominance) anomaly
 * detection. Practical-significance floors are deliberately disallowed
 * because they have no meaning against a categorical baseline — there's
 * no μ to subtract from.
 */
export interface ChartMetaAnomalyCategorical extends BaseHealthResultMeta {
  "x-chart-type": ChartType;
  "x-anomaly-enabled": true;
  "x-anomaly-direction": CategoricalAnomalyDirection;
  "x-anomaly-min-absolute-delta"?: never;
  "x-anomaly-min-relative-delta"?: never;
}

/**
 * Union of the two anomaly-enabled variants. Kept for back-compat with
 * existing callers — new code should narrow against the discriminated
 * union directly via `x-anomaly-direction`.
 */
export type ChartMetaAnomalyEnabled =
  | ChartMetaAnomalyNumeric
  | ChartMetaAnomalyCategorical;

/**
 * Metadata for a field that exposes a chart but explicitly disables anomaly detection.
 */
export interface ChartMetaAnomalyDisabled extends BaseHealthResultMeta {
  "x-chart-type": ChartType;
  "x-anomaly-enabled": false;
  "x-anomaly-direction"?: never;
  "x-anomaly-min-absolute-delta"?: never;
  "x-anomaly-min-relative-delta"?: never;
}

/**
 * Metadata for a field that does NOT expose a chart.
 */
export interface NonChartMeta extends BaseHealthResultMeta {
  "x-chart-type"?: never;
  "x-anomaly-enabled"?: never;
  "x-anomaly-direction"?: never;
  "x-anomaly-min-absolute-delta"?: never;
  "x-anomaly-min-relative-delta"?: never;
}

/**
 * Metadata type for health check result schemas.
 * Provides autocompletion and enforces that ANY field exposing a chart
 * MUST explicitly define its anomaly behavior.
 */
export type HealthResultMeta =
  | ChartMetaAnomalyNumeric
  | ChartMetaAnomalyCategorical
  | ChartMetaAnomalyDisabled
  | NonChartMeta;
