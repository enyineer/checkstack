import React from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { DependencyApi } from "@checkstack/dependency-common";
import { CatalogApi } from "@checkstack/catalog-common";
import type { DependencyExclusionMode } from "@checkstack/slo-common";
import {
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@checkstack/ui";
import { ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";

interface DependencyExclusionConfigProps {
  systemId: string;
  mode: DependencyExclusionMode;
  onModeChange: (mode: DependencyExclusionMode) => void;
  excludedIds: string[];
  onExcludedIdsChange: (ids: string[]) => void;
}

/**
 * Configuration component for SLO dependency exclusion.
 * Shows mode selector and auto-discovered upstream dependency checklist.
 */
export const DependencyExclusionConfig: React.FC<
  DependencyExclusionConfigProps
> = ({ systemId, mode, onModeChange, excludedIds, onExcludedIdsChange }) => {
  const depClient = usePluginClient(DependencyApi);
  const catalogClient = usePluginClient(CatalogApi);

  // Fetch upstream dependencies for this system
  const { data: depData } = depClient.getDependencies.useQuery(
    { systemId, direction: "upstream" },
    { enabled: !!systemId },
  );

  // Fetch system names for display
  const { data: systemsData } = catalogClient.getSystems.useQuery({});

  const upstreamDeps = depData?.dependencies ?? [];
  const systemNameMap = new Map(
    systemsData?.systems.map((s) => [s.id, s.name]),
  );

  const handleToggle = (depSystemId: string) => {
    if (excludedIds.includes(depSystemId)) {
      onExcludedIdsChange(excludedIds.filter((id) => id !== depSystemId));
    } else {
      onExcludedIdsChange([...excludedIds, depSystemId]);
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div className="grid gap-2">
        <Label>Dependency Exclusion Mode</Label>
        <Select
          value={mode}
          onValueChange={(v) => onModeChange(v as DependencyExclusionMode)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="strict">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-destructive" />
                Strict — All downtime counts
              </div>
            </SelectItem>
            <SelectItem value="self-only">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                Self-Only — Exclude upstream-attributed downtime
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {mode === "strict"
            ? "All downtime counts against the error budget, regardless of root cause."
            : "Only self-caused downtime counts. Upstream failures are attributed but excluded from budget consumption."}
        </p>
      </div>

      {/* Upstream dependency exclusion list */}
      {mode === "self-only" && upstreamDeps.length > 0 && (
        <div className="grid gap-2">
          <Label className="flex items-center gap-2">
            <ShieldOff className="w-4 h-4" />
            Excluded Dependencies
          </Label>
          <p className="text-xs text-muted-foreground">
            Check dependencies to exclude from upstream attribution. Downtime
            from excluded upstreams will count as self-caused.
          </p>
          <div className="space-y-2 rounded-md border border-border p-3">
            {upstreamDeps.map((dep) => {
              const upstreamId =
                dep.sourceSystemId === systemId
                  ? dep.targetSystemId
                  : dep.sourceSystemId;
              const isExcluded = excludedIds.includes(upstreamId);
              const name =
                systemNameMap.get(upstreamId) ?? upstreamId;

              return (
                <label
                  key={dep.id}
                  className="flex items-center gap-2 cursor-pointer text-sm hover:bg-muted/50 rounded px-2 py-1 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={isExcluded}
                    onChange={() => handleToggle(upstreamId)}
                    className="rounded border-border"
                  />
                  <span className={isExcluded ? "line-through text-muted-foreground" : ""}>
                    {name}
                  </span>
                  {isExcluded && (
                    <span className="text-xs text-muted-foreground">
                      (treated as self)
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {mode === "self-only" && upstreamDeps.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No upstream dependencies configured for this system.
        </p>
      )}
    </div>
  );
};
