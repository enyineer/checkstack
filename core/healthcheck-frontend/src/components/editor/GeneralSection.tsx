import React from "react";
import type { HealthCheckStrategyDto } from "@checkstack/healthcheck-common";
import { Input, Label, DynamicForm } from "@checkstack/ui";
import { AlertTriangle } from "lucide-react";

interface GeneralSectionProps {
  name: string;
  intervalSeconds: number;
  strategyConfig: Record<string, unknown>;
  strategy: HealthCheckStrategyDto | undefined;
  onNameChange: (name: string) => void;
  onIntervalChange: (interval: number) => void;
  onStrategyConfigChange: (config: Record<string, unknown>) => void;
  onStrategyConfigValidChange: (isValid: boolean) => void;
}

export const GeneralSection: React.FC<GeneralSectionProps> = ({
  name,
  intervalSeconds,
  strategyConfig,
  strategy,
  onNameChange,
  onIntervalChange,
  onStrategyConfigChange,
  onStrategyConfigValidChange,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">General</h2>
        <p className="text-sm text-muted-foreground">
          Basic configuration for this health check.
        </p>
      </div>

      {/* Strategy Display */}
      {strategy && (
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-surface-inset px-3 py-2">
          <span className="text-sm font-medium">{strategy.displayName}</span>
          {strategy.description && (
            <span className="text-xs text-muted-foreground">
              - {strategy.description}
            </span>
          )}
        </div>
      )}

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="hc-name">Name</Label>
        <Input
          id="hc-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Production API Health"
        />
      </div>

      {/* Interval */}
      <div className="space-y-2">
        <Label htmlFor="hc-interval">Interval (seconds)</Label>
        <Input
          id="hc-interval"
          type="number"
          min={1}
          value={intervalSeconds}
          onChange={(e) => onIntervalChange(Number(e.target.value))}
        />
        {intervalSeconds > 0 && intervalSeconds < 60 && (
          <div className="flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="h-3 w-3" />
            <span>
              Sub-minute intervals may cause high load on monitored services.
            </span>
          </div>
        )}
      </div>

      {/* Strategy Config */}
      {strategy?.configSchema && (
        <div className="space-y-3 pt-2 border-t">
          <div>
            <h3 className="text-sm font-semibold">Strategy Configuration</h3>
            <p className="text-xs text-muted-foreground">
              Settings specific to {strategy.displayName}.
            </p>
          </div>
          <DynamicForm
            schema={strategy.configSchema}
            value={strategyConfig}
            onChange={onStrategyConfigChange}
            onValidChange={onStrategyConfigValidChange}
          />
        </div>
      )}
    </div>
  );
};
