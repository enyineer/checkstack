import React from "react";
import { Checkbox, EmptyState, Label, Skeleton, Tooltip } from "@checkstack/ui";
import { Satellite, Layers } from "lucide-react";
import {
  environmentSectionView,
  type EnvironmentSelectorMode,
} from "./environment-selector.logic";

interface SatelliteDto {
  id: string;
  name: string;
  region: string;
  status: "online" | "offline";
}

interface EnvironmentDto {
  id: string;
  name: string;
}

interface ExecutionPanelProps {
  includeLocal: boolean;
  satelliteIds: string[];
  satellites: SatelliteDto[];
  onToggleLocal: () => void;
  onToggleSatellite: (satelliteId: string) => void;
  /**
   * Per-SATELLITE environment scoping, keyed by satellite id. An absent key
   * means that satellite runs every environment the assignment resolves to.
   */
  satelliteEnvironmentIds: Record<string, string[] | null>;
  /** Scope a satellite to all environments (`null`) or to a specific list. */
  onSetSatelliteEnvironmentMode: (
    satelliteId: string,
    mode: "all" | "specific",
  ) => void;
  onToggleSatelliteEnvironment: (
    satelliteId: string,
    environmentId: string,
  ) => void;
  /**
   * Per-assignment environment selector value. null = all current
   * environments; [] = opt out (env-less); non-empty = those env ids.
   */
  environmentIds: string[] | null;
  /** Environments the system currently belongs to. */
  environments: EnvironmentDto[];
  /**
   * Whether the environments query has successfully resolved. The
   * "No environment configured" empty-state only shows once this is true, so a
   * still-loading or errored fetch keeps the mode selector visible instead of
   * masquerading as a genuinely env-less system.
   */
  environmentsSettled: boolean;
  /**
   * Whether the environments query is still in its first fetch (no data yet).
   * While true the subsection shows a skeleton instead of the selector, so a
   * genuinely env-less system does not flash the mode selector before
   * collapsing to the empty-state. An errored fetch is not "loading", so it
   * still falls through to the (deliberately preserved) selector.
   */
  environmentsLoading: boolean;
  onSetEnvironmentMode: (mode: EnvironmentSelectorMode) => void;
  onToggleEnvironment: (environmentId: string) => void;
  saving: boolean;
  isLocked?: boolean;
}

/**
 * Panel for configuring where a health check executes:
 * core server (local) and/or remote satellites.
 */
export const ExecutionPanel: React.FC<ExecutionPanelProps> = ({
  includeLocal,
  satelliteIds,
  satellites,
  onToggleLocal,
  onToggleSatellite,
  satelliteEnvironmentIds,
  onSetSatelliteEnvironmentMode,
  onToggleSatelliteEnvironment,
  environmentIds,
  environments,
  environmentsSettled,
  environmentsLoading,
  onSetEnvironmentMode,
  onToggleEnvironment,
  saving,
  isLocked,
}) => {
  const hasSatellites = satelliteIds.length > 0;
  const willRunAnywhere = includeLocal || hasSatellites;
  const envView = environmentSectionView({
    environments,
    environmentIds,
    settled: environmentsSettled,
  });
  const selectedEnvIds = new Set<string>(
    environmentIds === null ? [] : environmentIds,
  );
  const envModes: { value: EnvironmentSelectorMode; label: string; hint: string }[] = [
    { value: "all", label: "All environments", hint: "Run once per environment the system belongs to" },
    { value: "specific", label: "Specific", hint: "Run only for the selected environments" },
    { value: "none", label: "None", hint: "Run once with no environment" },
  ];

  return (
    <div className="p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Execution Sources</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Choose where this health check runs. You can combine local
          execution with remote satellites.
        </p>
      </div>

      {/* Include Local Toggle */}
      <div className="p-4 bg-surface-inset rounded-lg border">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={includeLocal}
            onCheckedChange={onToggleLocal}
            disabled={saving || isLocked || (!hasSatellites && includeLocal)}
          />
          <div>
            <Label className="text-sm font-medium">Run Locally</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Execute this health check on the core server
            </p>
          </div>
        </div>
        {!includeLocal && !hasSatellites && (
          <p className="text-xs text-warning mt-2">
            ⚠ Enable at least one execution source (local or satellite)
          </p>
        )}
      </div>

      {/* Satellite Picker */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Assigned Satellites</Label>
          <Tooltip content="Select which satellites should execute this health check remotely" />
        </div>
        {satellites.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-2">
            No satellites registered. Create one in the Satellites settings.
          </p>
        ) : (
          <div className="space-y-1.5">
            {satellites.map((sat) => {
              const isChecked = satelliteIds.includes(sat.id);
              return (
                <div
                  key={sat.id}
                  className="flex items-center gap-3 p-2.5 rounded-md border hover:bg-muted/30 transition-colors"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => onToggleSatellite(sat.id)}
                    disabled={saving || isLocked}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Satellite className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium truncate">
                        {sat.name}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {sat.region}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full ${
                      sat.status === "online"
                        ? "bg-success/10 text-success"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {sat.status === "online" ? "Online" : "Offline"}
                  </span>
                </div>
              );
            })}
            {/* Per-satellite scoping, only worth showing once a satellite is
                actually assigned AND there is more than one environment to
                choose between - otherwise the control has nothing to decide. */}
            {environments.length > 0 &&
              satellites
                .filter((sat) => satelliteIds.includes(sat.id))
                .map((sat) => {
                  const scope = satelliteEnvironmentIds[sat.id];
                  const scoped = Array.isArray(scope);
                  const selected = new Set(scope);
                  return (
                    <div
                      key={`${sat.id}-scope`}
                      className="ml-6 space-y-1.5 rounded-md border border-dashed p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">
                          {sat.name}: environments
                        </span>
                        <Tooltip content="Which environments this satellite probes. Scope a satellite to the environments it can actually reach - a staging-network satellite should not be probing production." />
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        {(["all", "specific"] as const).map((mode) => (
                          <label
                            key={mode}
                            className="flex items-center gap-1.5 text-xs cursor-pointer"
                          >
                            <input
                              type="radio"
                              name={`sat-env-mode-${sat.id}`}
                              checked={scoped === (mode === "specific")}
                              disabled={saving || isLocked}
                              onChange={() =>
                                onSetSatelliteEnvironmentMode(sat.id, mode)
                              }
                            />
                            {mode === "all"
                              ? "All environments"
                              : "Specific environments"}
                          </label>
                        ))}
                      </div>
                      {scoped && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pl-5">
                          {environments.map((env) => (
                            <label
                              key={env.id}
                              className="flex items-center gap-2 text-xs cursor-pointer"
                            >
                              <Checkbox
                                checked={selected.has(env.id)}
                                onCheckedChange={() =>
                                  onToggleSatelliteEnvironment(sat.id, env.id)
                                }
                                disabled={saving || isLocked}
                              />
                              <span className="truncate">{env.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      {scoped && selected.size === 0 && (
                        <p className="text-xs text-muted-foreground">
                          No environment selected: this satellite runs the check
                          once, with no environment in context.
                        </p>
                      )}
                    </div>
                  );
                })}
          </div>
        )}
      </div>

      {/* Environment Selector */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <Label className="text-sm font-medium">Environments</Label>
          <Tooltip content="Fan this check out into one run per environment. The custom fields of each environment are exposed to scripts and templating." />
        </div>
        <p className="text-xs text-muted-foreground">
          Choose how this check fans out across the system's environments.
        </p>

        {environmentsLoading ? (
          <div className="space-y-1.5" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-14 w-full rounded-md" />
            ))}
          </div>
        ) : envView.kind === "empty" ? (
          <EmptyState
            icon={<Layers className="h-10 w-10" />}
            title="No environment configured"
            description="This system doesn't belong to any environment yet. Attach environments to the system in the catalog to fan this check out per environment."
          />
        ) : (
          <>
            <div className="space-y-1.5">
              {envModes.map((m) => (
                <label
                  key={m.value}
                  className="flex items-start gap-3 p-2.5 rounded-md border hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <input
                    type="radio"
                    name="environment-mode"
                    className="mt-1"
                    checked={envView.mode === m.value}
                    disabled={saving || isLocked}
                    onChange={() => onSetEnvironmentMode(m.value)}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{m.label}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {m.hint}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {envView.mode === "specific" && (
              <div className="space-y-1.5 pl-6">
                {environments.map((env) => (
                  <div
                    key={env.id}
                    className="flex items-center gap-3 p-2 rounded-md border hover:bg-muted/30 transition-colors"
                  >
                    <Checkbox
                      checked={selectedEnvIds.has(env.id)}
                      onCheckedChange={() => onToggleEnvironment(env.id)}
                      disabled={saving || isLocked}
                    />
                    <span className="text-sm truncate">{env.name}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Execution Summary */}
      <div className="p-3 bg-surface-inset rounded-lg border text-xs text-muted-foreground">
        <span className="font-medium">Execution: </span>
        {willRunAnywhere ? (
          <>
            {includeLocal && "Core server"}
            {includeLocal && hasSatellites && " + "}
            {hasSatellites &&
              `${satelliteIds.length} satellite${satelliteIds.length > 1 ? "s" : ""}`}
          </>
        ) : (
          <span className="text-warning">No execution sources configured</span>
        )}
      </div>
    </div>
  );
};
