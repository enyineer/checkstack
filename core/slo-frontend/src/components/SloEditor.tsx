import React, { useState, useEffect, useId, useMemo } from "react";
import { usePluginClient, useApi, accessApiRef } from "@checkstack/frontend-api";
import { SloApi, type SloObjective } from "../api";
import type { System } from "@checkstack/catalog-common";
import {
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import type { DependencyExclusionMode } from "@checkstack/slo-common";
import { sloAccess } from "@checkstack/slo-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import {
  TeamOwnershipPicker,
  teamCreateErrorMessage,
} from "@checkstack/auth-frontend";
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
  FormError,
  ConfirmationModal,
  useToast,
  toastError,
  toastSuccess,
  useUnsavedChanges,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@checkstack/ui";
import {
  validateSloForm,
  deriveSloFieldErrors,
  isSloFormValid,
  type SloFieldKey,
} from "./sloEditor.logic";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objective?: SloObjective;
  systems: System[];
  onSave: () => void;
}

const DEFAULTS = {
  systemId: "",
  target: "99.9",
  windowDays: "30",
  dependencyExclusion: "strict" as DependencyExclusionMode,
  warningPercent: "50",
  criticalPercent: "80",
};

export const SloEditor: React.FC<Props> = ({
  open,
  onOpenChange,
  objective,
  systems,
  onSave,
}) => {
  const sloClient = usePluginClient(SloApi);
  const hcClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const fieldIds = useId();

  const { allowed: allowGlobal } = accessApi.useAccess(sloAccess.slo.manage);

  // Only systems the user may MANAGE are selectable: the backend now parent-
  // gates SLO creation on the target system (unless the caller holds the global
  // SLO rule, which lets it target any).
  const { canAccess: canManageSystem } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: systems.map((s) => s.id),
  });
  const selectableSystems = allowGlobal
    ? systems
    : systems.filter((s) => canManageSystem(s.id));

  // Form state
  const [systemId, setSystemId] = useState(DEFAULTS.systemId);
  const [ownerTeamId, setOwnerTeamId] = useState<string | null>(null);
  const [ownerTeamError, setOwnerTeamError] = useState<string | null>(null);
  const [target, setTarget] = useState(DEFAULTS.target);
  const [windowDays, setWindowDays] = useState(DEFAULTS.windowDays);
  const [dependencyExclusion, setDependencyExclusion] =
    useState<DependencyExclusionMode>(DEFAULTS.dependencyExclusion);
  const [warningPercent, setWarningPercent] = useState(DEFAULTS.warningPercent);
  const [criticalPercent, setCriticalPercent] = useState(
    DEFAULTS.criticalPercent,
  );
  const [healthCheckConfigurationId, setHealthCheckConfigurationId] =
    useState<string | undefined>();

  // Fields the user has interacted with (or that a submit attempt forced).
  // Inline errors only show for touched fields so the form does not nag while
  // it is still being filled in for the first time (mirrors DynamicForm).
  const [touched, setTouched] = useState<Partial<Record<SloFieldKey, boolean>>>(
    {},
  );
  const [discardOpen, setDiscardOpen] = useState(false);

  const markTouched = (key: SloFieldKey) =>
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));

  // Snapshot of the values the form was seeded with, used for dirty-tracking.
  const initialSnapshot = useMemo(() => {
    if (objective) {
      return {
        target: String(objective.target),
        windowDays: String(objective.windowDays),
        dependencyExclusion: objective.dependencyExclusion,
        warningPercent: String(objective.burnRateThresholds.warningPercent),
        criticalPercent: String(objective.burnRateThresholds.criticalPercent),
        healthCheckConfigurationId:
          objective.healthCheckConfigurationId ?? undefined,
        systemId: objective.systemId,
        ownerTeamId: null as string | null,
      };
    }
    return {
      ...DEFAULTS,
      healthCheckConfigurationId: undefined as string | undefined,
      ownerTeamId: null as string | null,
    };
  }, [objective]);

  const isDirty =
    systemId !== initialSnapshot.systemId ||
    target !== initialSnapshot.target ||
    windowDays !== initialSnapshot.windowDays ||
    dependencyExclusion !== initialSnapshot.dependencyExclusion ||
    warningPercent !== initialSnapshot.warningPercent ||
    criticalPercent !== initialSnapshot.criticalPercent ||
    healthCheckConfigurationId !== initialSnapshot.healthCheckConfigurationId ||
    ownerTeamId !== initialSnapshot.ownerTeamId;

  // Guard in-app navigation / tab close while the open editor has edits.
  useUnsavedChanges({ isDirty: open && isDirty });

  // Fetch health check associations for the selected system
  const effectiveSystemId = systemId || objective?.systemId;
  const { data: hcAssociationsData } = hcClient.getSystemAssociations.useQuery(
    { systemId: effectiveSystemId ?? "" },
    { enabled: !!effectiveSystemId },
  );

  // Reset form when objective changes / dialog reopens
  useEffect(() => {
    setSystemId(initialSnapshot.systemId);
    setTarget(initialSnapshot.target);
    setWindowDays(initialSnapshot.windowDays);
    setDependencyExclusion(initialSnapshot.dependencyExclusion);
    setWarningPercent(initialSnapshot.warningPercent);
    setCriticalPercent(initialSnapshot.criticalPercent);
    setHealthCheckConfigurationId(initialSnapshot.healthCheckConfigurationId);
    setOwnerTeamId(initialSnapshot.ownerTeamId);
    setOwnerTeamError(null);
    setTouched({});
  }, [initialSnapshot, open]);

  // Single source of truth for client-side validation.
  const fieldErrors = deriveSloFieldErrors({
    systemId,
    target,
    windowDays,
    warningPercent,
    criticalPercent,
  });
  const formValid = isSloFormValid(fieldErrors);

  // An inline error only surfaces once its field is touched. For the system
  // field this is omitted entirely in edit mode (the control is not rendered).
  const visibleError = (key: SloFieldKey): string | undefined =>
    touched[key] ? fieldErrors[key] : undefined;

  // Mutations
  const createMutation = sloClient.createObjective.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "SLO objective created");
      onSave();
    },
    onError: (error) => {
      const inline = teamCreateErrorMessage(error);
      if (inline) {
        setOwnerTeamError(inline);
        return;
      }
      toastError(toast, "Failed to create", error);
    },
  });

  const updateMutation = sloClient.updateObjective.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "SLO objective updated");
      onSave();
    },
    onError: (error) => {
      toastError(toast, "Failed to update", error);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOwnerTeamError(null);

    // Reveal every field's error on a submit attempt so an invalid field that
    // was never focused still surfaces its message.
    if (!formValid) {
      setTouched({
        systemId: true,
        target: true,
        windowDays: true,
        warningPercent: true,
        criticalPercent: true,
      });
      return;
    }

    const validation = validateSloForm({
      systemId,
      target,
      windowDays,
      warningPercent,
      criticalPercent,
    });
    // Defensive: deriveSloFieldErrors already gates this path, but keep the
    // parse result authoritative for the numeric values.
    if (!validation.ok) {
      return;
    }
    const {
      target: targetNum,
      windowDays: windowNum,
      warningPercent: warningNum,
      criticalPercent: criticalNum,
    } = validation.value;

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
        teamId: ownerTeamId ?? undefined,
      });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  const systemAssociations = hcAssociationsData ?? [];

  // Request close: confirm first when there are unsaved edits.
  const requestClose = () => {
    if (isDirty && !saving) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  };

  const errorId = (key: SloFieldKey) => `${fieldIds}-${key}-error`;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            requestClose();
            return;
          }
          onOpenChange(true);
        }}
      >
        <DialogContent>
          <form onSubmit={handleSubmit}>
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
              {/* System selector and ownership — only for create */}
              {!objective && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor={`${fieldIds}-system`} required>
                      System
                    </Label>
                    <Select
                      value={systemId}
                      onValueChange={(v) => {
                        setSystemId(v);
                        markTouched("systemId");
                      }}
                    >
                      <SelectTrigger
                        id={`${fieldIds}-system`}
                        autoFocus
                        aria-invalid={visibleError("systemId") ? true : undefined}
                        aria-describedby={
                          visibleError("systemId")
                            ? errorId("systemId")
                            : undefined
                        }
                      >
                        <SelectValue placeholder="Select a system" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectableSystems.map((system) => (
                          <SelectItem key={system.id} value={system.id}>
                            {system.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormError id={errorId("systemId")} className="text-xs">
                      {visibleError("systemId")}
                    </FormError>
                  </div>
                  <TeamOwnershipPicker
                    value={ownerTeamId}
                    onChange={(id) => {
                      setOwnerTeamId(id);
                      setOwnerTeamError(null);
                    }}
                    allowGlobal={allowGlobal}
                    error={ownerTeamError}
                  />
                </>
              )}

              {/* Health Check scope - only show when system has associated HCs */}
              {systemAssociations.length > 0 && (
                <div className="grid gap-2">
                  <Label htmlFor={`${fieldIds}-hc-scope`}>
                    Health Check Scope
                  </Label>
                  <Select
                    value={healthCheckConfigurationId ?? "__all__"}
                    onValueChange={(v) =>
                      setHealthCheckConfigurationId(
                        v === "__all__" ? undefined : v,
                      )
                    }
                  >
                    <SelectTrigger
                      id={`${fieldIds}-hc-scope`}
                      aria-label="Health Check Scope"
                    >
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
                <Label htmlFor={`${fieldIds}-target`} required>
                  Availability Target (%)
                </Label>
                <Input
                  id={`${fieldIds}-target`}
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  autoFocus={!!objective}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  onBlur={() => markTouched("target")}
                  placeholder="99.9"
                  aria-invalid={visibleError("target") ? true : undefined}
                  aria-describedby={
                    visibleError("target") ? errorId("target") : undefined
                  }
                />
                <FormError id={errorId("target")} className="text-xs">
                  {visibleError("target")}
                </FormError>
                <p className="text-xs text-muted-foreground">
                  Common targets: 99.0% (3.65 days/year), 99.9% (8.76
                  hours/year), 99.95% (4.38 hours/year)
                </p>
              </div>

              {/* Rolling window */}
              <div className="grid gap-2">
                <Label htmlFor={`${fieldIds}-window`} required>
                  Rolling Window (days)
                </Label>
                <Input
                  id={`${fieldIds}-window`}
                  type="number"
                  min="1"
                  value={windowDays}
                  onChange={(e) => setWindowDays(e.target.value)}
                  onBlur={() => markTouched("windowDays")}
                  placeholder="30"
                  aria-invalid={visibleError("windowDays") ? true : undefined}
                  aria-describedby={
                    visibleError("windowDays")
                      ? errorId("windowDays")
                      : undefined
                  }
                />
                <FormError id={errorId("windowDays")} className="text-xs">
                  {visibleError("windowDays")}
                </FormError>
              </div>

              {/* Dependency exclusion mode */}
              <div className="grid gap-2">
                <Label htmlFor={`${fieldIds}-dep-exclusion`}>
                  Dependency Exclusion Mode
                </Label>
                <Select
                  value={dependencyExclusion}
                  onValueChange={(v) =>
                    setDependencyExclusion(v as DependencyExclusionMode)
                  }
                >
                  <SelectTrigger
                    id={`${fieldIds}-dep-exclusion`}
                    aria-label="Dependency Exclusion Mode"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strict">
                      Strict - All downtime counts
                    </SelectItem>
                    <SelectItem value="self-only">
                      Self-Only - Exclude upstream-attributed downtime
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
                  <Label htmlFor={`${fieldIds}-warning`}>
                    Warning Threshold (%)
                  </Label>
                  <Input
                    id={`${fieldIds}-warning`}
                    type="number"
                    min="0"
                    max="100"
                    value={warningPercent}
                    onChange={(e) => setWarningPercent(e.target.value)}
                    onBlur={() => markTouched("warningPercent")}
                    aria-invalid={
                      visibleError("warningPercent") ? true : undefined
                    }
                    aria-describedby={
                      visibleError("warningPercent")
                        ? errorId("warningPercent")
                        : undefined
                    }
                  />
                  <FormError
                    id={errorId("warningPercent")}
                    className="text-xs"
                  >
                    {visibleError("warningPercent")}
                  </FormError>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${fieldIds}-critical`}>
                    Critical Threshold (%)
                  </Label>
                  <Input
                    id={`${fieldIds}-critical`}
                    type="number"
                    min="0"
                    max="100"
                    value={criticalPercent}
                    onChange={(e) => setCriticalPercent(e.target.value)}
                    onBlur={() => markTouched("criticalPercent")}
                    aria-invalid={
                      visibleError("criticalPercent") ? true : undefined
                    }
                    aria-describedby={
                      visibleError("criticalPercent")
                        ? errorId("criticalPercent")
                        : undefined
                    }
                  />
                  <FormError
                    id={errorId("criticalPercent")}
                    className="text-xs"
                  >
                    {visibleError("criticalPercent")}
                  </FormError>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={requestClose}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !formValid}>
                {saving ? "Saving..." : objective ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmationModal
        isOpen={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          onOpenChange(false);
        }}
        title="Discard changes?"
        message="You have unsaved changes. Are you sure you want to discard them?"
        confirmText="Discard"
        cancelText="Keep editing"
        variant="warning"
      />
    </>
  );
};
