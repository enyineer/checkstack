import type { AnomalySettings, AnomalyDirection } from "../schema";

export interface EffectiveConfig {
  enabled: boolean;
  sensitivity: number;
  confirmationWindow: number;
  direction?: AnomalyDirection;
}

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

  return {
    enabled,
    sensitivity,
    confirmationWindow,
    direction,
  };
}
