import React, { useState, useEffect } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { SloApi, type SloObjective } from "../api";
import type { System } from "@checkstack/catalog-common";
import type { DependencyExclusionMode } from "@checkstack/slo-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Label,
  useToast,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objective?: SloObjective;
  systems: System[];
  onSave: () => void;
}

export const SloEditor: React.FC<Props> = ({
  open,
  onOpenChange,
  objective,
  systems,
  onSave,
}) => {
  const sloClient = usePluginClient(SloApi);
  const hcClient = usePluginClient(HealthCheckApi);
  const toast = useToast();

  // Form state
  const [systemId, setSystemId] = useState("");
  const [target, setTarget] = useState("99.9");
  const [windowDays, setWindowDays] = useState("30");
  const [dependencyExclusion, setDependencyExclusion] =
    useState<DependencyExclusionMode>("strict");
  const [warningPercent, setWarningPercent] = useState("50");
  const [criticalPercent, setCriticalPercent] = useState("80");
  const [healthCheckConfigurationId, setHealthCheckConfigurationId] =
    useState<string | undefined>();
  // Fetch health check associations for the selected system
  const effectiveSystemId = systemId || objective?.systemId;
  const { data: hcAssociationsData } =
    hcClient.getSystemAssociations.useQuery(
      { systemId: effectiveSystemId ?? "" },
      { enabled: !!effectiveSystemId },
    );

  // Reset form when objective changes
  useEffect(() => {
    if (objective) {
      setSystemId(objective.systemId);
      setTarget(String(objective.target));
      setWindowDays(String(objective.windowDays));
      setDependencyExclusion(objective.dependencyExclusion);
      setWarningPercent(
        String(objective.burnRateThresholds.warningPercent),
      );
      setCriticalPercent(
        String(objective.burnRateThresholds.criticalPercent),
      );
      setHealthCheckConfigurationId(
        objective.healthCheckConfigurationId ?? undefined,
      );
    } else {
      setSystemId("");
      setTarget("99.9");
      setWindowDays("30");
      setDependencyExclusion("strict");
      setWarningPercent("50");
      setCriticalPercent("80");
      setHealthCheckConfigurationId(undefined);
    }
  }, [objective, open]);

  // Mutations
  const createMutation = sloClient.createObjective.useMutation({
    onSuccess: () => {
      toast.success("SLO objective created");
      onSave();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to create"));
    },
  });

  const updateMutation = sloClient.updateObjective.useMutation({
    onSuccess: () => {
      toast.success("SLO objective updated");
      onSave();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to update"));
    },
  });

  const handleSubmit = () => {
    const targetNum = Number.parseFloat(target);
    const windowNum = Number.parseInt(windowDays, 10);
    const warningNum = Number.parseFloat(warningPercent);
    const criticalNum = Number.parseFloat(criticalPercent);

    if (!systemId) {
      toast.error("Please select a system");
      return;
    }
    if (Number.isNaN(targetNum) || targetNum < 0 || targetNum > 100) {
      toast.error("Target must be between 0 and 100");
      return;
    }
    if (Number.isNaN(windowNum) || windowNum < 1) {
      toast.error("Window must be at least 1 day");
      return;
    }

    if (objective) {
      updateMutation.mutate({
        id: objective.id,
        target: targetNum,
        windowDays: windowNum,
        dependencyExclusion,
        burnRateThresholds: {
          warningPercent: warningNum,
          criticalPercent: criticalNum,
          fastBurnMultiplier: 5,
        },
      });
    } else {
      createMutation.mutate({
        systemId,
        healthCheckConfigurationId,
        target: targetNum,
        windowDays: windowNum,
        dependencyExclusion,
        burnRateThresholds: {
          warningPercent: warningNum,
          criticalPercent: criticalNum,
          fastBurnMultiplier: 5,
        },
      });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  const systemAssociations = hcAssociationsData ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {objective ? "Edit SLO Objective" : "Create SLO Objective"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {objective
              ? "Modify SLO objective settings"
              : "Define a new Service Level Objective for a system"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* System selector - only for create */}
          {!objective && (
            <div className="grid gap-2">
              <Label htmlFor="slo-system">System</Label>
              <Select value={systemId} onValueChange={setSystemId}>
                <SelectTrigger id="slo-system">
                  <SelectValue placeholder="Select a system" />
                </SelectTrigger>
                <SelectContent>
                  {systems.map((system) => (
                    <SelectItem key={system.id} value={system.id}>
                      {system.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Health Check scope - only show when system has associated HCs */}
          {systemAssociations.length > 0 && (
            <div className="grid gap-2">
              <Label>Health Check Scope</Label>
              <Select
                value={healthCheckConfigurationId ?? "__all__"}
                onValueChange={(v) =>
                  setHealthCheckConfigurationId(
                    v === "__all__" ? undefined : v,
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    All health checks (system-global)
                  </SelectItem>
                  {systemAssociations.map((assoc) => (
                    <SelectItem
                      key={assoc.configurationId}
                      value={assoc.configurationId}
                    >
                      {assoc.configurationName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {healthCheckConfigurationId
                  ? "This SLO only tracks downtime from the selected health check."
                  : "This SLO tracks all health checks for the system."}
              </p>
            </div>
          )}


          {/* Target */}
          <div className="grid gap-2">
            <Label htmlFor="slo-target">Availability Target (%)</Label>
            <Input
              id="slo-target"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="99.9"
            />
            <p className="text-xs text-muted-foreground">
              Common targets: 99.0% (3.65 days/year), 99.9% (8.76
              hours/year), 99.95% (4.38 hours/year)
            </p>
          </div>

          {/* Rolling window */}
          <div className="grid gap-2">
            <Label htmlFor="slo-window">Rolling Window (days)</Label>
            <Input
              id="slo-window"
              type="number"
              min="1"
              value={windowDays}
              onChange={(e) => setWindowDays(e.target.value)}
              placeholder="30"
            />
          </div>

          {/* Dependency exclusion mode */}
          <div className="grid gap-2">
            <Label>Dependency Exclusion Mode</Label>
            <Select
              value={dependencyExclusion}
              onValueChange={(v) =>
                setDependencyExclusion(v as DependencyExclusionMode)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strict">
                  Strict — All downtime counts
                </SelectItem>
                <SelectItem value="self-only">
                  Self-Only — Exclude upstream-attributed downtime
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {dependencyExclusion === "strict"
                ? "All downtime counts against the error budget, regardless of cause."
                : "Only self-caused downtime counts. When an upstream dependency is also down, that time is excluded."}
            </p>
          </div>

          {/* Burn rate thresholds */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="slo-warning">Warning Threshold (%)</Label>
              <Input
                id="slo-warning"
                type="number"
                min="0"
                max="100"
                value={warningPercent}
                onChange={(e) => setWarningPercent(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="slo-critical">Critical Threshold (%)</Label>
              <Input
                id="slo-critical"
                type="number"
                min="0"
                max="100"
                value={criticalPercent}
                onChange={(e) => setCriticalPercent(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : objective ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
