import { useState } from "react";
import { Power, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardContent } from "./Card";
import { Button } from "./Button";
import { Badge, type BadgeProps } from "./Badge";
import { Toggle } from "./Toggle";
import { DynamicForm } from "./DynamicForm";
import { DynamicIcon, type LucideIconName } from "./DynamicIcon";
import { MarkdownBlock } from "./Markdown";
import { cn } from "../utils";

/**
 * A configuration section that can be displayed in the card
 */
export interface ConfigSection {
  /** Unique identifier for this section */
  id: string;
  /** Section title (e.g., "Configuration", "Layout Settings") */
  title: string;
  /** JSON Schema for the configuration form */
  schema: Record<string, unknown>;
  /** Current configuration values */
  value?: Record<string, unknown>;
  /** Called when configuration is saved */
  onSave?: (config: Record<string, unknown>) => Promise<void>;
}

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
  /** Lucide icon name in PascalCase (e.g., 'AlertCircle', 'HeartPulse') */
  icon?: LucideIconName;
  /** Whether the strategy is currently enabled */
  enabled: boolean;
}

export interface StrategyConfigCardProps {
  /** The strategy data to display */
  strategy: StrategyConfigCardData;
  /**
   * Configuration sections to display when expanded.
   * Each section has its own schema, values, and save handler.
   */
  configSections?: ConfigSection[];
  /**
   * Called when the enabled state changes
   * @returns Promise that resolves when the update is complete
   */
  onToggle?: (id: string, enabled: boolean) => Promise<void>;
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
  /**
   * Markdown instructions to show when expanded.
   * Rendered before the configuration sections.
   */
  instructions?: string;
}

/**
 * Shared component for configuring strategies (auth, notification, etc.)
 * Provides a consistent accordion-style card with enable/disable toggle,
 * expandable configuration sections, and save functionality.
 */
export function StrategyConfigCard({
  strategy,
  configSections = [],
  onToggle,
  saving,
  badges = [],
  disabledWarning,
  toggleDisabled,
  expanded: controlledExpanded,
  onExpandedChange,
  subtitle,
  useToggleSwitch = false,
  configMissing = false,
  instructions,
}: StrategyConfigCardProps) {
  // Internal state for uncontrolled mode
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(strategy.enabled);

  // Section-specific state for form values
  const [sectionValues, setSectionValues] = useState<
    Record<string, Record<string, unknown>>
  >(() => {
    const initial: Record<string, Record<string, unknown>> = {};
    for (const section of configSections) {
      initial[section.id] = section.value ?? {};
    }
    return initial;
  });

  // Section-specific validation state
  const [sectionValid, setSectionValid] = useState<Record<string, boolean>>(
    () => {
      const initial: Record<string, boolean> = {};
      for (const section of configSections) {
        // Start as true for existing configs
        initial[section.id] = true;
      }
      return initial;
    }
  );

  // Determine if we're in controlled or uncontrolled mode
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;
  const setExpanded = isControlled
    ? (value: boolean) => onExpandedChange?.(value)
    : setInternalExpanded;

  // Check if there are sections to show
  const hasSections = configSections.length > 0;

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

  const handleExpandClick = () => {
    setExpanded(!expanded);
  };

  const handleSectionValueChange = (
    sectionId: string,
    value: Record<string, unknown>
  ) => {
    setSectionValues((prev) => ({ ...prev, [sectionId]: value }));
  };

  const handleSectionValidChange = (sectionId: string, isValid: boolean) => {
    setSectionValid((prev) => ({ ...prev, [sectionId]: isValid }));
  };

  const handleSaveSection = async (section: ConfigSection) => {
    if (section.onSave) {
      await section.onSave(sectionValues[section.id] ?? {});
    }
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
            {hasSections && (
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

      {/* Expanded configuration sections */}
      {expanded && hasSections && (
        <CardContent className="border-t bg-muted/30 p-4 space-y-6">
          {!localEnabled && disabledWarning && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 bg-muted rounded">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {disabledWarning}
            </div>
          )}

          {/* Instructions block */}
          {instructions && (
            <div className="p-4 bg-muted/50 rounded-lg border border-border/50">
              <MarkdownBlock size="sm">{instructions}</MarkdownBlock>
            </div>
          )}

          {configSections
            .filter((section) => {
              // Check if section has fields
              return (
                section.schema &&
                "properties" in section.schema &&
                Object.keys(section.schema.properties as object).length > 0
              );
            })
            .map((section) => (
              <div key={section.id}>
                {/* Section title (only show if multiple sections) */}
                {configSections.length > 1 && (
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">
                    {section.title}
                  </h4>
                )}

                <DynamicForm
                  schema={section.schema}
                  value={sectionValues[section.id] ?? {}}
                  onChange={(value) =>
                    handleSectionValueChange(section.id, value)
                  }
                  onValidChange={(isValid) =>
                    handleSectionValidChange(section.id, isValid)
                  }
                />

                {section.onSave && (
                  <div className="mt-4 flex justify-end">
                    <Button
                      onClick={() => void handleSaveSection(section)}
                      disabled={saving || !sectionValid[section.id]}
                      size="sm"
                    >
                      {saving ? "Saving..." : `Save ${section.title}`}
                    </Button>
                  </div>
                )}
              </div>
            ))}
        </CardContent>
      )}
    </Card>
  );
}
