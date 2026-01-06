import { StrategyConfigCard, type ConfigSection } from "@checkmate-monitor/ui";
import type { AuthStrategy } from "../api";

export interface AuthStrategyCardProps {
  strategy: AuthStrategy;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onSaveConfig: (id: string, config: Record<string, unknown>) => Promise<void>;
  saving?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  config?: Record<string, unknown>;
}

/**
 * Auth strategy card using the shared StrategyConfigCard component.
 * Uses Toggle switch style for auth strategies.
 */
export function AuthStrategyCard({
  strategy,
  onToggle,
  onSaveConfig,
  saving,
  disabled,
  expanded,
  onExpandedChange,
  config,
}: AuthStrategyCardProps) {
  // Check if config schema has properties
  const hasConfigSchema =
    strategy.configSchema &&
    "properties" in strategy.configSchema &&
    Object.keys(strategy.configSchema.properties as Record<string, unknown>)
      .length > 0;

  // Config is missing if schema has properties but no saved config
  const configMissing = hasConfigSchema && strategy.config === undefined;

  // Build config sections
  const configSections: ConfigSection[] = [];
  if (hasConfigSchema) {
    configSections.push({
      id: "config",
      title: "Configuration",
      schema: strategy.configSchema,
      value: config ?? strategy.config,
      onSave: async (newConfig) => {
        await onSaveConfig(strategy.id, newConfig);
      },
    });
  }

  return (
    <StrategyConfigCard
      strategy={{
        id: strategy.id,
        displayName: strategy.displayName,
        description: strategy.description,
        icon: strategy.icon,
        enabled: strategy.enabled,
      }}
      configSections={configSections}
      onToggle={onToggle}
      saving={saving}
      toggleDisabled={disabled}
      useToggleSwitch={true}
      configMissing={configMissing}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      instructions={strategy.adminInstructions}
    />
  );
}
