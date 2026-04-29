import type { AnomalySettings, AnomalyDirection } from "../schema";

export interface EffectiveConfig {
  enabled: boolean;
  sensitivity: number;
  confirmationWindow: number;
  direction?: AnomalyDirection;
  driftEnabled: boolean;
  driftThreshold: number;
}

/**
 * Resolves the effective anomaly detection config for a specific field path
 * using the Three-Layer Override Model.
 *
 * Resolution order (highest to lowest precedence):
 * 1. Assignment field override (most specific — user override for a specific field on a specific system)
 * 2. Template field override (plugin developer annotation for a specific field)
 * 3. Assignment global (user override for the entire system assignment)
 * 4. Template global (plugin developer default for the entire health check)
 * 5. Engine defaults (hardcoded fallback values)
 *
 * Note: Field-level overrides always win over global overrides because they
 * represent more specific intent. If a template marks a field as `enabled: false`,
 * only an assignment-level field override can re-enable it — the assignment global
 * `enabled: true` won't override it, since the template field config is more specific.
 */
export function resolveEffectiveConfig(
  path: string,
  templateConfig?: AnomalySettings,
  assignmentConfig?: Partial<AnomalySettings>
): EffectiveConfig {
  const fieldConfig = assignmentConfig?.fieldOverrides?.[path] ?? templateConfig?.fieldOverrides?.[path];
  
  const enabled = fieldConfig?.enabled 
    ?? assignmentConfig?.enabled 
    ?? templateConfig?.enabled 
    ?? true;

  const sensitivity = fieldConfig?.sensitivity 
    ?? assignmentConfig?.sensitivity 
    ?? templateConfig?.sensitivity 
    ?? 1;

  const confirmationWindow = fieldConfig?.confirmationWindow 
    ?? assignmentConfig?.confirmationWindow 
    ?? templateConfig?.confirmationWindow 
    ?? 3;

  const direction = fieldConfig?.direction;

  const driftEnabled = fieldConfig?.driftEnabled
    ?? assignmentConfig?.driftEnabled
    ?? templateConfig?.driftEnabled
    ?? true;

  const driftThreshold = fieldConfig?.driftThreshold
    ?? assignmentConfig?.driftThreshold
    ?? templateConfig?.driftThreshold
    ?? 2;

  return {
    enabled,
    sensitivity,
    confirmationWindow,
    direction,
    driftEnabled,
    driftThreshold,
  };
}

