import { useState } from "react";
import { Power, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardContent } from "./Card";
import { Button } from "./Button";
import { Badge, type BadgeProps } from "./Badge";
import { Toggle } from "./Toggle";
import { DynamicForm } from "./DynamicForm";
import { DynamicIcon } from "./DynamicIcon";
import { cn } from "../utils";

/**
 * Base strategy data that can be displayed in the card
 */
export interface StrategyConfigCardData {
  /** Unique identifier for the strategy */
  id: string;
  /** Display name shown in the header */
  displayName: string;
  /** Optional description shown below the title */
  description?: string;
  /** Lucide icon name (e.g., 'mail', 'github', 'server') */
  icon?: string;
  /** Whether the strategy is currently enabled */
  enabled: boolean;
  /** JSON Schema for the configuration form */
  configSchema: Record<string, unknown>;
  /** Current configuration values */
  config?: Record<string, unknown>;
}

export interface StrategyConfigCardProps {
  /** The strategy data to display */
  strategy: StrategyConfigCardData;
  /**
   * Called when the enabled state changes
   * @returns Promise that resolves when the update is complete
   */
  onToggle?: (id: string, enabled: boolean) => Promise<void>;
  /**
   * Called when the configuration is saved
   * @returns Promise that resolves when the save is complete
   */
  onSaveConfig?: (id: string, config: Record<string, unknown>) => Promise<void>;
  /** Whether save/toggle operations are in progress */
  saving?: boolean;
  /** Additional badges to show after the title */
  badges?: Array<{
    label: string;
    variant?: BadgeProps["variant"];
    className?: string;
  }>;
  /** Optional warning message shown when strategy is disabled but expanded */
  disabledWarning?: string;
  /** Whether toggle should be disabled (e.g., config required first) */
  toggleDisabled?: boolean;
  /** Controls whether the card is expanded (controlled mode) */
  expanded?: boolean;
  /** Called when expansion state changes (controlled mode) */
  onExpandedChange?: (expanded: boolean) => void;
  /** Optional subtitle shown below description (e.g., "From: plugin-name") */
  subtitle?: string;
  /** Use Toggle switch instead of Button for enable/disable */
  useToggleSwitch?: boolean;
  /**
   * Whether config is missing (has schema but no saved config).
   * When true, shows "Needs Configuration" badge and disables toggle.
   */
  configMissing?: boolean;
}

/**
 * Shared component for configuring strategies (auth, notification, etc.)
 * Provides a consistent accordion-style card with enable/disable toggle,
 * expandable configuration form, and save functionality.
 */
export function StrategyConfigCard({
  strategy,
  onToggle,
  onSaveConfig,
  saving,
  badges = [],
  disabledWarning,
  toggleDisabled,
  expanded: controlledExpanded,
  onExpandedChange,
  subtitle,
  useToggleSwitch = false,
  configMissing = false,
}: StrategyConfigCardProps) {
  // Internal state for uncontrolled mode
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown>>(
    strategy.config ?? {}
  );
  const [localEnabled, setLocalEnabled] = useState(strategy.enabled);

  // Determine if we're in controlled or uncontrolled mode
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;
  const setExpanded = isControlled
    ? (value: boolean) => onExpandedChange?.(value)
    : setInternalExpanded;

  // Check if there are config fields to show
  const hasConfigFields =
    strategy.configSchema &&
    "properties" in strategy.configSchema &&
    Object.keys(strategy.configSchema.properties as object).length > 0;

  // Build final badges array - add "Needs Configuration" if config is missing
  const finalBadges = [
    ...badges,
    ...(configMissing
      ? [{ label: "Needs Configuration", variant: "warning" as const }]
      : []),
  ];

  // Toggle should be disabled if config is missing (must configure first)
  const isToggleDisabled = saving || toggleDisabled || configMissing;

  const handleToggle = async (newEnabled: boolean) => {
    if (onToggle) {
      setLocalEnabled(newEnabled);
      await onToggle(strategy.id, newEnabled);
    }
  };

  const handleSaveConfig = async () => {
    if (onSaveConfig) {
      await onSaveConfig(strategy.id, config);
    }
  };

  const handleExpandClick = () => {
    setExpanded(!expanded);
  };

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all",
        localEnabled ? "border-primary/30" : "opacity-80"
      )}
    >
      <CardHeader className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            {/* Expand/Collapse button */}
            {hasConfigFields && (
              <button
                onClick={handleExpandClick}
                className="text-muted-foreground hover:text-foreground transition-colors"
                type="button"
              >
                {expanded ? (
                  <ChevronDown className="h-5 w-5" />
                ) : (
                  <ChevronRight className="h-5 w-5" />
                )}
              </button>
            )}

            {/* Icon */}
            <DynamicIcon
              name={strategy.icon}
              className="h-5 w-5 text-muted-foreground"
            />

            {/* Title and description */}
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{strategy.displayName}</span>
                {finalBadges.map((badge, index) => (
                  <Badge
                    key={index}
                    variant={badge.variant}
                    className={badge.className}
                  >
                    {badge.label}
                  </Badge>
                ))}
              </div>
              {strategy.description && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {strategy.description}
                </p>
              )}
              {subtitle && (
                <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
              )}
            </div>
          </div>

          {/* Enable/Disable control */}
          <div className="flex items-center gap-2">
            {useToggleSwitch ? (
              <Toggle
                checked={localEnabled}
                disabled={isToggleDisabled}
                onCheckedChange={(checked) => void handleToggle(checked)}
              />
            ) : (
              <Button
                variant={localEnabled ? "primary" : "outline"}
                size="sm"
                onClick={() => void handleToggle(!localEnabled)}
                disabled={isToggleDisabled}
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
            )}
          </div>
        </div>
      </CardHeader>

      {/* Expanded configuration form */}
      {expanded && hasConfigFields && (
        <CardContent className="border-t bg-muted/30 p-4">
          {!localEnabled && disabledWarning && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4 p-2 bg-muted rounded">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {disabledWarning}
            </div>
          )}
          <DynamicForm
            schema={strategy.configSchema}
            value={config}
            onChange={setConfig}
          />
          {onSaveConfig && (
            <div className="mt-4 flex justify-end">
              <Button
                onClick={() => void handleSaveConfig()}
                disabled={saving}
                size="sm"
              >
                {saving ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
