import React, { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { CatalogApi } from "@checkstack/catalog-common";
import type { ImpactType } from "@checkstack/dependency-common";
import { Button, Badge } from "@checkstack/ui";
import { Plus, Trash2, ChevronDown, ChevronUp, Filter } from "lucide-react";

/**
 * A scope cell: which slice of the target this edge watches, at what severity.
 * `null` on either axis means "any" (any check / any environment).
 */
export interface ScopeCell {
  healthCheckId: string | null;
  environmentId: string | null;
  overrideImpactType: ImpactType;
}

interface Props {
  /** The upstream (target) system ID to scope against. */
  targetSystemId: string;
  /** Current scope cells. */
  rules: ScopeCell[];
  /** Callback when cells change. */
  onChange: (rules: ScopeCell[]) => void;
  /** Compact mode for tight layouts like the map edge editor. */
  compact?: boolean;
}

const ANY = "__any__";

/**
 * Editor for a dependency's scope matrix. Each row pins the watched slice of
 * the target to a specific check and/or environment (or "Any") and gives it a
 * severity. With no rows, the dependency watches the target's overall health
 * (any check, any environment) - the default behaviour.
 */
export const HealthCheckRulesEditor: React.FC<Props> = ({
  targetSystemId,
  rules,
  onChange,
  compact = false,
}) => {
  const [expanded, setExpanded] = useState(rules.length > 0);

  const healthCheckClient = usePluginClient(HealthCheckApi);
  const catalogClient = usePluginClient(CatalogApi);

  const { data: associations } =
    healthCheckClient.getSystemAssociations.useQuery(
      { systemId: targetSystemId },
      { enabled: !!targetSystemId },
    );
  const { data: allEnvironments } = catalogClient.listEnvironments.useQuery({});

  const availableChecks = associations ?? [];
  // Only environments the target system actually belongs to are meaningful.
  const availableEnvironments = (allEnvironments ?? []).filter((env) =>
    env.systemIds.includes(targetSystemId),
  );

  const canScope =
    availableChecks.length > 0 || availableEnvironments.length > 0;

  const updateCell = (index: number, patch: Partial<ScopeCell>) => {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addCell = () => {
    onChange([
      ...rules,
      { healthCheckId: null, environmentId: null, overrideImpactType: "critical" },
    ]);
  };

  const removeCell = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };

  if (!canScope) {
    return;
  }

  return (
    <div
      className={`rounded-lg border border-border ${compact ? "p-2" : "p-3"} bg-surface-inset`}
    >
      <button
        type="button"
        className="flex items-center justify-between w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className={`font-medium ${compact ? "text-xs" : "text-sm"}`}>
            Scope (check / environment)
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
            Narrow this dependency to a specific check and/or environment of the
            upstream system, each with its own severity. With no rows, it
            watches any check in any environment.
          </p>

          {rules.map((cell, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface p-2"
            >
              <select
                aria-label="Health check"
                className="text-xs rounded border border-input bg-surface-inset px-2 py-1 flex-1 min-w-24"
                value={cell.healthCheckId ?? ANY}
                onChange={(e) =>
                  updateCell(index, {
                    healthCheckId: e.target.value === ANY ? null : e.target.value,
                  })
                }
              >
                <option value={ANY}>Any check</option>
                {availableChecks.map((check) => (
                  <option
                    key={check.configurationId}
                    value={check.configurationId}
                  >
                    {check.configurationName}
                  </option>
                ))}
              </select>

              <select
                aria-label="Environment"
                className="text-xs rounded border border-input bg-surface-inset px-2 py-1 flex-1 min-w-24"
                value={cell.environmentId ?? ANY}
                onChange={(e) =>
                  updateCell(index, {
                    environmentId: e.target.value === ANY ? null : e.target.value,
                  })
                }
              >
                <option value={ANY}>Any environment</option>
                {availableEnvironments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="Severity"
                className="text-xs rounded border border-input bg-surface-inset px-2 py-1"
                value={cell.overrideImpactType}
                onChange={(e) =>
                  updateCell(index, {
                    overrideImpactType: e.target.value as ImpactType,
                  })
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
                onClick={() => removeCell(index)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={addCell}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add scope
          </Button>

          {rules.length === 0 && (
            <p className="text-xs text-muted-foreground/60 italic">
              No scopes - this dependency watches any check in any environment.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
