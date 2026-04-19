import React from "react";
import { Checkbox, Label, Tooltip } from "@checkstack/ui";
import { Satellite } from "lucide-react";

interface SatelliteDto {
  id: string;
  name: string;
  region: string;
  status: "online" | "offline";
}

interface ExecutionPanelProps {
  includeLocal: boolean;
  satelliteIds: string[];
  satellites: SatelliteDto[];
  onToggleLocal: () => void;
  onToggleSatellite: (satelliteId: string) => void;
  saving: boolean;
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
  saving,
}) => {
  const hasSatellites = satelliteIds.length > 0;
  const willRunAnywhere = includeLocal || hasSatellites;

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
      <div className="p-4 bg-muted/50 rounded-lg border">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={includeLocal}
            onCheckedChange={onToggleLocal}
            disabled={saving || (!hasSatellites && includeLocal)}
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
                    disabled={saving}
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
          </div>
        )}
      </div>

      {/* Execution Summary */}
      <div className="p-3 bg-muted/30 rounded-lg border text-xs text-muted-foreground">
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
