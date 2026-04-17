import React, { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import type { ImpactType } from "@checkstack/dependency-common";
import { Button, Badge } from "@checkstack/ui";
import { Plus, Trash2, ChevronDown, ChevronUp, Activity } from "lucide-react";

interface HealthCheckRule {
  healthCheckId: string;
  overrideImpactType: ImpactType;
}

interface Props {
  /** The upstream system ID to query health checks for */
  targetSystemId: string;
  /** Current rules */
  rules: HealthCheckRule[];
  /** Callback when rules change */
  onChange: (rules: HealthCheckRule[]) => void;
  /** Compact mode for tight layouts like the map edge editor */
  compact?: boolean;
}

/**
 * Collapsible editor for health check rules on a dependency edge.
 * When rules are configured, the dependency only triggers for failures
 * of the specified health checks (with optional per-check impact override).
 */
export const HealthCheckRulesEditor: React.FC<Props> = ({
  targetSystemId,
  rules,
  onChange,
  compact = false,
}) => {
  const [expanded, setExpanded] = useState(rules.length > 0);

  // Fetch health checks for the target (upstream) system
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const { data: associations } =
    healthCheckClient.getSystemAssociations.useQuery(
      { systemId: targetSystemId },
      { enabled: !!targetSystemId },
    );

  const availableChecks = associations ?? [];

  // Filter out already-added checks
  const unusedChecks = availableChecks.filter(
    (check) => !rules.some((r) => r.healthCheckId === check.configurationId),
  );

  const handleAddRule = (configurationId: string) => {
    onChange([
      ...rules,
      { healthCheckId: configurationId, overrideImpactType: "critical" },
    ]);
  };

  const handleRemoveRule = (healthCheckId: string) => {
    onChange(rules.filter((r) => r.healthCheckId !== healthCheckId));
  };

  const handleImpactChange = (
    healthCheckId: string,
    impactType: ImpactType,
  ) => {
    onChange(
      rules.map((r) =>
        r.healthCheckId === healthCheckId
          ? { ...r, overrideImpactType: impactType }
          : r,
      ),
    );
  };

  const getCheckName = (healthCheckId: string): string =>
    availableChecks.find((c) => c.configurationId === healthCheckId)
      ?.configurationName ?? healthCheckId;

  if (availableChecks.length === 0) {
    return;
  }

  return (
    <div
      className={`rounded-lg border border-border ${compact ? "p-2" : "p-3"} bg-muted/20`}
    >
      <button
        type="button"
        className="flex items-center justify-between w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className={`font-medium ${compact ? "text-xs" : "text-sm"}`}>
            Health check rules
          </span>
          {rules.length > 0 && (
            <Badge variant="outline" className="text-xs h-5">
              {rules.length}
            </Badge>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            When rules are configured, this dependency only triggers warnings
            when the specified health checks fail. Each rule can override the
            impact type.
          </p>

          {/* Existing rules */}
          {rules.map((rule) => (
            <div
              key={rule.healthCheckId}
              className="flex items-center gap-2 rounded border border-border bg-background p-2"
            >
              <span className="text-xs flex-1 truncate font-medium">
                {getCheckName(rule.healthCheckId)}
              </span>
              <select
                className="text-xs rounded border border-input bg-background px-2 py-1"
                value={rule.overrideImpactType}
                onChange={(e) =>
                  handleImpactChange(
                    rule.healthCheckId,
                    e.target.value as ImpactType,
                  )
                }
              >
                <option value="informational">Info</option>
                <option value="degraded">Degraded</option>
                <option value="critical">Critical</option>
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => handleRemoveRule(rule.healthCheckId)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}

          {/* Add new rule */}
          {unusedChecks.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                id="add-hc-rule"
                className="flex-1 text-xs rounded border border-input bg-background px-2 py-1.5"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleAddRule(e.target.value);
                    e.target.value = "";
                  }
                }}
              >
                <option value="" disabled>
                  Add health check...
                </option>
                {unusedChecks.map((check) => (
                  <option
                    key={check.configurationId}
                    value={check.configurationId}
                  >
                    {check.configurationName}
                  </option>
                ))}
              </select>
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}

          {rules.length === 0 && unusedChecks.length > 0 && (
            <p className="text-xs text-muted-foreground/60 italic">
              No rules configured — all health check failures trigger this
              dependency.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
