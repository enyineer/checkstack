import type { AnomalySettings, AnomalyDirection } from "../schema";

export interface EffectiveConfig {
  enabled: boolean;
  sensitivity: number;
  confirmationWindow: number;
  direction?: AnomalyDirection;
  driftEnabled: boolean;
  driftThreshold: number;
  /** Practical-significance floor on absolute deviation (default 0). */
  minAbsoluteDelta: number;
  /** Practical-significance floor on relative deviation (default 0). */
  minRelativeDelta: number;
}

/**
 * Per-field schema-declared anomaly defaults. These are the plugin author's
 * tuned defaults — the layer beneath user-supplied field overrides.
 */
export interface SchemaDefaults {
  sensitivity?: number;
  confirmationWindow?: number;
  driftEnabled?: boolean;
  driftThreshold?: number;
  minAbsoluteDelta?: number;
  minRelativeDelta?: number;
}

/** Engine fallback constants — used only when neither the user nor the schema set a value. */
const ENGINE_DEFAULTS = {
  enabled: true,
  sensitivity: 1,
  confirmationWindow: 3,
  driftEnabled: true,
  driftThreshold: 2,
  minAbsoluteDelta: 0,
  minRelativeDelta: 0,
} as const;

/**
 * Resolves the effective anomaly detection config for a specific field path.
 *
 * Resolution order (highest to lowest precedence):
 * 1. Assignment field override
 * 2. Template field override
 * 3. Schema annotation (plugin-author default)
 * 4. Engine fallback constant
 *
 * Globals were removed in favour of per-field configuration only. Plugin
 * defaults are tuned per-field with awareness of each metric's unit and
 * nature, so a single global multiplier across heterogeneous fields would
 * be meaningless. Templates and assignments influence detection through
 * `fieldOverrides`; the only true global on `AnomalySettings` is the master
 * `enabled` toggle (and the `baselineWindow` / `notify` knobs which are
 * inherently scoped to the whole assignment).
 */
export function resolveEffectiveConfig(
  path: string,
  templateConfig?: AnomalySettings,
  assignmentConfig?: Partial<AnomalySettings>,
  schemaDefaults?: SchemaDefaults
): EffectiveConfig {
  const fieldConfig =
    assignmentConfig?.fieldOverrides?.[path] ??
    templateConfig?.fieldOverrides?.[path];

  // The master toggle remains a global — it's the kill switch for the
  // entire assignment, not a per-field setting. A field override of
  // `enabled: false` can still locally opt out.
  const enabled = fieldConfig?.enabled
    ?? assignmentConfig?.enabled
    ?? templateConfig?.enabled
    ?? ENGINE_DEFAULTS.enabled;

  const sensitivity = fieldConfig?.sensitivity
    ?? schemaDefaults?.sensitivity
    ?? ENGINE_DEFAULTS.sensitivity;

  const confirmationWindow = fieldConfig?.confirmationWindow
    ?? schemaDefaults?.confirmationWindow
    ?? ENGINE_DEFAULTS.confirmationWindow;

  const direction = fieldConfig?.direction;

  const driftEnabled = fieldConfig?.driftEnabled
    ?? schemaDefaults?.driftEnabled
    ?? ENGINE_DEFAULTS.driftEnabled;

  const driftThreshold = fieldConfig?.driftThreshold
    ?? schemaDefaults?.driftThreshold
    ?? ENGINE_DEFAULTS.driftThreshold;

  const minAbsoluteDelta = fieldConfig?.minAbsoluteDelta
    ?? schemaDefaults?.minAbsoluteDelta
    ?? ENGINE_DEFAULTS.minAbsoluteDelta;

  const minRelativeDelta = fieldConfig?.minRelativeDelta
    ?? schemaDefaults?.minRelativeDelta
    ?? ENGINE_DEFAULTS.minRelativeDelta;

  return {
    enabled,
    sensitivity,
    confirmationWindow,
    direction,
    driftEnabled,
    driftThreshold,
    minAbsoluteDelta,
    minRelativeDelta,
  };
}
