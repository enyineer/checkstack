import { StrategyConfigCard } from "@checkmate/ui";

/**
 * Strategy data from getDeliveryStrategies endpoint
 */
export interface DeliveryStrategy {
  qualifiedId: string;
  displayName: string;
  description?: string;
  icon?: string;
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
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface StrategyCardProps {
  strategy: DeliveryStrategy;
  onUpdate: (
    strategyId: string,
    enabled: boolean,
    config?: Record<string, unknown>
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
    await onUpdate(id, enabled, strategy.config);
  };

  const handleSaveConfig = async (
    id: string,
    config: Record<string, unknown>
  ) => {
    await onUpdate(id, strategy.enabled, config);
  };

  return (
    <StrategyConfigCard
      strategy={{
        id: strategy.qualifiedId,
        displayName: strategy.displayName,
        description: strategy.description,
        icon: strategy.icon,
        enabled: strategy.enabled,
        configSchema: strategy.configSchema,
        config: strategy.config,
      }}
      onToggle={handleToggle}
      onSaveConfig={handleSaveConfig}
      saving={saving}
      badges={badges}
      subtitle={`From: ${strategy.ownerPluginId}`}
      disabledWarning="Enable this channel to allow users to receive notifications"
      configMissing={configMissing}
    />
  );
}
