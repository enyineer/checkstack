import {
  StrategyConfigCard,
  type ConfigSection,
  type LucideIconName,
} from "@checkmate-monitor/ui";

/**
 * Strategy data from getDeliveryStrategies endpoint
 */
export interface DeliveryStrategy {
  qualifiedId: string;
  displayName: string;
  description?: string;
  icon?: LucideIconName;
  ownerPluginId: string;
  contactResolution: {
    type:
      | "auth-email"
      | "auth-provider"
      | "user-config"
      | "oauth-link"
      | "custom";
    provider?: string;
    field?: string;
  };
  requiresUserConfig: boolean;
  requiresOAuthLink: boolean;
  configSchema: Record<string, unknown>;
  userConfigSchema?: Record<string, unknown>;
  /** Layout config schema for admin customization (logo, colors, etc.) */
  layoutConfigSchema?: Record<string, unknown>;
  enabled: boolean;
  config?: Record<string, unknown>;
  /** Current layout config values */
  layoutConfig?: Record<string, unknown>;
  /** Markdown instructions for admins (setup guides, etc.) */
  adminInstructions?: string;
}

export interface StrategyCardProps {
  strategy: DeliveryStrategy;
  onUpdate: (
    strategyId: string,
    enabled: boolean,
    config?: Record<string, unknown>,
    layoutConfig?: Record<string, unknown>
  ) => Promise<void>;
  saving?: boolean;
}

/**
 * Get contact resolution type badge for notification strategies
 */
function getResolutionBadge(
  type: DeliveryStrategy["contactResolution"]["type"]
) {
  switch (type) {
    case "auth-email": {
      return { label: "User Email", variant: "secondary" as const };
    }
    case "auth-provider": {
      return { label: "Auth Provider", variant: "secondary" as const };
    }
    case "user-config": {
      return { label: "User Config Required", variant: "outline" as const };
    }
    case "oauth-link": {
      return { label: "OAuth Link", variant: "default" as const };
    }
    default: {
      return { label: "Custom", variant: "outline" as const };
    }
  }
}

/**
 * Admin card for configuring a delivery strategy.
 * Uses the shared StrategyConfigCard component.
 */
export function StrategyCard({
  strategy,
  onUpdate,
  saving,
}: StrategyCardProps) {
  // Build badges array from strategy properties
  const badges = [
    getResolutionBadge(strategy.contactResolution.type),
    ...(strategy.requiresOAuthLink
      ? [{ label: "OAuth", variant: "outline" as const, className: "text-xs" }]
      : []),
  ];

  // Check if config is missing - has schema properties but no saved config
  const hasConfigSchema =
    strategy.configSchema &&
    "properties" in strategy.configSchema &&
    Object.keys(strategy.configSchema.properties as Record<string, unknown>)
      .length > 0;
  const configMissing = hasConfigSchema && strategy.config === undefined;

  const handleToggle = async (id: string, enabled: boolean) => {
    await onUpdate(id, enabled, strategy.config, strategy.layoutConfig);
  };

  // Build config sections array
  const configSections: ConfigSection[] = [];

  // Main configuration section
  if (hasConfigSchema) {
    configSections.push({
      id: "config",
      title: "Configuration",
      schema: strategy.configSchema,
      value: strategy.config,
      onSave: async (config) => {
        await onUpdate(
          strategy.qualifiedId,
          strategy.enabled,
          config,
          strategy.layoutConfig
        );
      },
    });
  }

  // Layout configuration section (if strategy supports it)
  if (strategy.layoutConfigSchema) {
    configSections.push({
      id: "layout",
      title: "Email Layout",
      schema: strategy.layoutConfigSchema,
      value: strategy.layoutConfig,
      onSave: async (layoutConfig) => {
        await onUpdate(
          strategy.qualifiedId,
          strategy.enabled,
          strategy.config,
          layoutConfig
        );
      },
    });
  }

  return (
    <StrategyConfigCard
      strategy={{
        id: strategy.qualifiedId,
        displayName: strategy.displayName,
        description: strategy.description,
        icon: strategy.icon,
        enabled: strategy.enabled,
      }}
      configSections={configSections}
      onToggle={handleToggle}
      saving={saving}
      badges={badges}
      subtitle={`From: ${strategy.ownerPluginId}`}
      disabledWarning="Enable this channel to allow users to receive notifications"
      configMissing={configMissing}
      instructions={strategy.adminInstructions}
    />
  );
}
