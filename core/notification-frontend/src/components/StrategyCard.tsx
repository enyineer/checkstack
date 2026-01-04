import { useState } from "react";
import { Power, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import {
  Card,
  Button,
  Badge,
  DynamicForm,
  cn,
  DynamicIcon,
} from "@checkmate/ui";

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
 * Admin card for configuring a delivery strategy.
 * Shows enable/disable toggle and expandable config form.
 */
export function StrategyCard({
  strategy,
  onUpdate,
  saving,
}: StrategyCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown>>(
    strategy.config ?? {}
  );
  const [localEnabled, setLocalEnabled] = useState(strategy.enabled);

  // Get contact resolution type badge
  const getResolutionBadge = () => {
    switch (strategy.contactResolution.type) {
      case "auth-email": {
        return <Badge variant="secondary">User Email</Badge>;
      }
      case "auth-provider": {
        return <Badge variant="secondary">Auth Provider</Badge>;
      }
      case "user-config": {
        return <Badge variant="outline">User Config Required</Badge>;
      }
      case "oauth-link": {
        return <Badge variant="default">OAuth Link</Badge>;
      }
      default: {
        return <Badge variant="outline">Custom</Badge>;
      }
    }
  };

  const handleEnableToggle = async () => {
    const newEnabled = !localEnabled;
    setLocalEnabled(newEnabled);
    await onUpdate(strategy.qualifiedId, newEnabled, config);
  };

  const handleSaveConfig = async () => {
    await onUpdate(strategy.qualifiedId, localEnabled, config);
  };

  const hasConfigFields = Object.keys(strategy.configSchema).length > 0;

  return (
    <Card
      className={cn(
        "overflow-hidden transition-colors",
        localEnabled ? "border-primary/30" : "opacity-75"
      )}
    >
      {/* Header - always visible */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <DynamicIcon
            name={strategy.icon}
            className="h-5 w-5 text-muted-foreground"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{strategy.displayName}</span>
              {getResolutionBadge()}
              {strategy.requiresOAuthLink && (
                <Badge variant="outline" className="text-xs">
                  OAuth
                </Badge>
              )}
            </div>
            {strategy.description && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {strategy.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              From: {strategy.ownerPluginId}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Enable/Disable toggle button */}
          <Button
            variant={localEnabled ? "primary" : "outline"}
            size="sm"
            onClick={() => void handleEnableToggle()}
            disabled={saving}
            className="min-w-[90px]"
          >
            <Power
              className={cn(
                "h-4 w-4 mr-1",
                localEnabled ? "text-green-300" : "text-muted-foreground"
              )}
            />
            {localEnabled ? "Enabled" : "Disabled"}
          </Button>

          {/* Expand button for config */}
          {hasConfigFields && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Expanded config form */}
      {expanded && hasConfigFields && (
        <div className="border-t p-4 bg-muted/30">
          {!localEnabled && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4 p-2 bg-muted rounded">
              <AlertCircle className="h-4 w-4" />
              Enable this channel to allow users to receive notifications
            </div>
          )}
          <DynamicForm
            schema={strategy.configSchema}
            value={config}
            onChange={setConfig}
          />
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => void handleSaveConfig()}
              disabled={saving}
              size="sm"
            >
              {saving ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
