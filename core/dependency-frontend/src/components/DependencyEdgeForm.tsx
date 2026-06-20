import React from "react";
import type { ImpactType } from "@checkstack/dependency-common";
import { Label, Toggle } from "@checkstack/ui";
import { HealthCheckRulesEditor } from "./HealthCheckRulesEditor";

interface HealthCheckRule {
  healthCheckId: string;
  overrideImpactType: ImpactType;
}

interface Props {
  /** Current impact type */
  impactType: ImpactType;
  /** Callback when impact type changes */
  onImpactTypeChange: (impactType: ImpactType) => void;
  /** Current transitive (multi-hop) setting */
  transitive: boolean;
  /** Callback when transitive setting changes */
  onTransitiveChange: (transitive: boolean) => void;
  /** The upstream system ID — needed for health check rules lookup */
  targetSystemId: string;
  /** Current health check rules */
  healthCheckRules: HealthCheckRule[];
  /** Callback when health check rules change */
  onHealthCheckRulesChange: (rules: HealthCheckRule[]) => void;
  /** Compact mode for tight layouts (e.g. map edge editor panel) */
  compact?: boolean;
}

/**
 * Shared form fields for editing a dependency edge.
 * Used by both the list editor (DependencyEditor) and the map edge editor panel.
 * Renders: impact type select, multi-hop toggle, and health check rules editor.
 */
export const DependencyEdgeForm: React.FC<Props> = ({
  impactType,
  onImpactTypeChange,
  transitive,
  onTransitiveChange,
  targetSystemId,
  healthCheckRules,
  onHealthCheckRulesChange,
  compact = false,
}) => {
  // Unique per-instance id: this form renders multiple times (the add panel
  // plus one per editing row), so a static id would collide.
  const impactId = React.useId();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={impactId} required>
          Impact
        </Label>
        <select
          id={impactId}
          className="w-full rounded-md border border-input bg-surface-inset px-3 py-2 text-sm"
          value={impactType}
          onChange={(e) => onImpactTypeChange(e.target.value as ImpactType)}
        >
          <option value="informational">Informational</option>
          <option value="degraded">Degraded</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div className="space-y-0.5">
          <Label>{compact ? "Multi-hop" : "Multi-hop propagation"}</Label>
          <p className="text-xs text-muted-foreground">
            {compact
              ? "Cascade failures transitively."
              : "Propagate status warnings through transitive dependency chains."}
          </p>
        </div>
        <Toggle
          checked={transitive}
          onCheckedChange={onTransitiveChange}
          aria-label="Enable multi-hop propagation"
        />
      </div>
      <HealthCheckRulesEditor
        targetSystemId={targetSystemId}
        rules={healthCheckRules}
        onChange={onHealthCheckRulesChange}
        compact={compact}
      />
    </>
  );
};
