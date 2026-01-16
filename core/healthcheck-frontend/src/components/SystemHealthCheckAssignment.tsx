import React, { useState } from "react";
import {
  usePluginClient,
  useApi,
  type SlotContext,
  accessApiRef,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Checkbox,
  Label,
  LoadingSpinner,
  useToast,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Tooltip,
} from "@checkstack/ui";
import { Activity, Settings2, History, Database } from "lucide-react";
import { Link } from "react-router-dom";
import { CatalogSystemActionsSlot } from "@checkstack/catalog-common";
import type { StateThresholds } from "@checkstack/healthcheck-common";
import {
  DEFAULT_STATE_THRESHOLDS,
  healthcheckRoutes,
  healthCheckAccess,
} from "@checkstack/healthcheck-common";
import { resolveRoute } from "@checkstack/common";
import { DEFAULT_RETENTION_CONFIG } from "@checkstack/healthcheck-common";

type SelectedPanel = { configId: string; panel: "thresholds" | "retention" };

type Props = SlotContext<typeof CatalogSystemActionsSlot>;

interface AssociationState {
  configurationId: string;
  configurationName: string;
  enabled: boolean;
  stateThresholds?: StateThresholds;
}

export const SystemHealthCheckAssignment: React.FC<Props> = ({
  systemId,
  systemName: _systemName,
}) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage } = accessApi.useAccess(
    healthCheckAccess.configuration.manage
  );
  const toast = useToast();

  // UI state
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPanel, setSelectedPanel] = useState<SelectedPanel>();
  const [localThresholds, setLocalThresholds] = useState<
    Record<string, StateThresholds>
  >({});
  const [retentionData, setRetentionData] = useState<
    Record<
      string,
      {
        rawRetentionDays: number;
        hourlyRetentionDays: number;
        dailyRetentionDays: number;
        isCustom: boolean;
      }
    >
  >({});

  // Query: Fetch configurations
  const { data: configurationsData, isLoading: configsLoading } =
    healthCheckClient.getConfigurations.useQuery({}, { enabled: isOpen });

  // Query: Fetch associations
  const {
    data: associations = [],
    isLoading: associationsLoading,
    refetch: refetchAssociations,
  } = healthCheckClient.getSystemAssociations.useQuery(
    { systemId },
    { enabled: true }
  );

  // Query: Fetch retention config for selected panel
  const selectedConfigId =
    selectedPanel?.panel === "retention" ? selectedPanel.configId : undefined;
  const { data: retentionConfigData } =
    healthCheckClient.getRetentionConfig.useQuery(
      { systemId, configurationId: selectedConfigId ?? "" },
      { enabled: !!selectedConfigId && !retentionData[selectedConfigId] }
    );

  // Update retention data when fetched
  React.useEffect(() => {
    if (
      retentionConfigData &&
      selectedConfigId &&
      !retentionData[selectedConfigId]
    ) {
      setRetentionData((prev) => ({
        ...prev,
        [selectedConfigId]: {
          rawRetentionDays:
            retentionConfigData.retentionConfig?.rawRetentionDays ??
            DEFAULT_RETENTION_CONFIG.rawRetentionDays,
          hourlyRetentionDays:
            retentionConfigData.retentionConfig?.hourlyRetentionDays ??
            DEFAULT_RETENTION_CONFIG.hourlyRetentionDays,
          dailyRetentionDays:
            retentionConfigData.retentionConfig?.dailyRetentionDays ??
            DEFAULT_RETENTION_CONFIG.dailyRetentionDays,
          isCustom: !!retentionConfigData.retentionConfig,
        },
      }));
    }
  }, [retentionConfigData, selectedConfigId, retentionData]);

  // Mutation: Associate system
  const associateMutation = healthCheckClient.associateSystem.useMutation({
    onSuccess: () => {
      void refetchAssociations();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update");
    },
  });

  // Mutation: Disassociate system
  const disassociateMutation = healthCheckClient.disassociateSystem.useMutation(
    {
      onSuccess: () => {
        void refetchAssociations();
      },
      onError: (error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to update"
        );
      },
    }
  );

  // Mutation: Update retention config
  const updateRetentionMutation =
    healthCheckClient.updateRetentionConfig.useMutation({
      onSuccess: () => {
        toast.success("Retention settings saved");
        setSelectedPanel(undefined);
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "Failed to save");
      },
    });

  const configs = configurationsData?.configurations ?? [];
  const loading = configsLoading || associationsLoading;
  const saving =
    associateMutation.isPending ||
    disassociateMutation.isPending ||
    updateRetentionMutation.isPending;

  const handleToggleAssignment = (
    configId: string,
    isCurrentlyAssigned: boolean
  ) => {
    const config = configs.find((c) => c.id === configId);
    if (!config) return;

    if (isCurrentlyAssigned) {
      disassociateMutation.mutate({ systemId, configId });
    } else {
      associateMutation.mutate({
        systemId,
        body: {
          configurationId: configId,
          enabled: true,
          stateThresholds: DEFAULT_STATE_THRESHOLDS,
        },
      });
    }
  };

  const handleThresholdChange = (
    configId: string,
    thresholds: StateThresholds
  ) => {
    setLocalThresholds((prev) => ({
      ...prev,
      [configId]: thresholds,
    }));
  };

  const handleSaveThresholds = (configId: string) => {
    const assoc = associations.find((a) => a.configurationId === configId);
    const thresholds = localThresholds[configId] ?? assoc?.stateThresholds;
    if (!assoc) return;

    associateMutation.mutate(
      {
        systemId,
        body: {
          configurationId: configId,
          enabled: assoc.enabled,
          stateThresholds: thresholds,
        },
      },
      {
        onSuccess: () => {
          toast.success("Thresholds saved");
          setSelectedPanel(undefined);
          setLocalThresholds((prev) => {
            const next = { ...prev };
            delete next[configId];
            return next;
          });
        },
      }
    );
  };

  const handleSaveRetention = (configId: string) => {
    const data = retentionData[configId];
    if (!data) return;

    updateRetentionMutation.mutate({
      systemId,
      configurationId: configId,
      retentionConfig: {
        rawRetentionDays: data.rawRetentionDays,
        hourlyRetentionDays: data.hourlyRetentionDays,
        dailyRetentionDays: data.dailyRetentionDays,
      },
    });
  };

  const handleResetRetention = (configId: string) => {
    updateRetentionMutation.mutate(
      {
        systemId,
        configurationId: configId,
        // eslint-disable-next-line unicorn/no-null -- RPC contract uses nullable()
        retentionConfig: null,
      },
      {
        onSuccess: () => {
          setRetentionData((prev) => ({
            ...prev,
            [configId]: {
              rawRetentionDays: DEFAULT_RETENTION_CONFIG.rawRetentionDays,
              hourlyRetentionDays: DEFAULT_RETENTION_CONFIG.hourlyRetentionDays,
              dailyRetentionDays: DEFAULT_RETENTION_CONFIG.dailyRetentionDays,
              isCustom: false,
            },
          }));
          toast.success("Reset to defaults");
        },
      }
    );
  };

  const updateRetentionField = (
    configId: string,
    field: string,
    value: number
  ) => {
    setRetentionData((prev) => ({
      ...prev,
      [configId]: { ...prev[configId], [field]: value, isCustom: true },
    }));
  };

  const assignedIds = associations.map((a) => a.configurationId);

  const getEffectiveThresholds = (assoc: AssociationState): StateThresholds => {
    return (
      localThresholds[assoc.configurationId] ??
      assoc.stateThresholds ??
      DEFAULT_STATE_THRESHOLDS
    );
  };

  const renderThresholdEditor = (assoc: AssociationState) => {
    const thresholds = getEffectiveThresholds(assoc);

    return (
      <div className="mt-4 space-y-4">
        {/* Mode Selector */}
        <div className="p-4 bg-muted/50 rounded-lg border">
          <div className="flex items-center gap-2 mb-2">
            <Label className="text-sm font-medium">Evaluation Mode</Label>
            <Tooltip content="How health status is calculated based on check results" />
          </div>
          <Select
            value={thresholds.mode}
            onValueChange={(value: "consecutive" | "window") => {
              if (value === "consecutive") {
                handleThresholdChange(assoc.configurationId, {
                  mode: "consecutive",
                  healthy: { minSuccessCount: 1 },
                  degraded: { minFailureCount: 2 },
                  unhealthy: { minFailureCount: 5 },
                });
              } else {
                handleThresholdChange(assoc.configurationId, {
                  mode: "window",
                  windowSize: 10,
                  degraded: { minFailureCount: 3 },
                  unhealthy: { minFailureCount: 7 },
                });
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="consecutive">
                Consecutive (streak-based)
              </SelectItem>
              <SelectItem value="window">
                Window (count in last N runs)
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-2">
            {thresholds.mode === "consecutive"
              ? "Status changes when a streak of consecutive results is reached."
              : "Status is based on how many failures occur within a rolling window."}
          </p>
        </div>

        {/* Threshold Configuration Cards */}
        {thresholds.mode === "consecutive" ? (
          <div className="space-y-3">
            {/* Healthy Threshold */}
            <div className="p-3 rounded-lg border border-success/30 bg-success/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <span className="text-sm font-medium text-success">
                    Healthy
                  </span>
                  <Tooltip content="System returns to healthy after this many consecutive successful checks" />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={thresholds.healthy.minSuccessCount}
                    onChange={(e) =>
                      handleThresholdChange(assoc.configurationId, {
                        ...thresholds,
                        healthy: {
                          minSuccessCount: Number.parseInt(e.target.value) || 1,
                        },
                      })
                    }
                    className="h-8 w-16 text-center"
                  />
                  <span className="text-xs text-muted-foreground w-20">
                    consecutive ✓
                  </span>
                </div>
              </div>
            </div>

            {/* Degraded Threshold */}
            <div className="p-3 rounded-lg border border-warning/30 bg-warning/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-warning" />
                  <span className="text-sm font-medium text-warning">
                    Degraded
                  </span>
                  <Tooltip content="System becomes degraded after this many consecutive failures" />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={thresholds.degraded.minFailureCount}
                    onChange={(e) =>
                      handleThresholdChange(assoc.configurationId, {
                        ...thresholds,
                        degraded: {
                          minFailureCount: Number.parseInt(e.target.value) || 1,
                        },
                      })
                    }
                    className="h-8 w-16 text-center"
                  />
                  <span className="text-xs text-muted-foreground w-20">
                    consecutive ✗
                  </span>
                </div>
              </div>
            </div>

            {/* Unhealthy Threshold */}
            <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-destructive" />
                  <span className="text-sm font-medium text-destructive">
                    Unhealthy
                  </span>
                  <Tooltip content="System becomes unhealthy after this many consecutive failures" />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={thresholds.unhealthy.minFailureCount}
                    onChange={(e) =>
                      handleThresholdChange(assoc.configurationId, {
                        ...thresholds,
                        unhealthy: {
                          minFailureCount: Number.parseInt(e.target.value) || 1,
                        },
                      })
                    }
                    className="h-8 w-16 text-center"
                  />
                  <span className="text-xs text-muted-foreground w-20">
                    consecutive ✗
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Window Size */}
            <div className="p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Window Size</span>
                  <Tooltip content="How many recent runs to analyze when calculating status" />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={3}
                    max={100}
                    value={thresholds.windowSize}
                    onChange={(e) =>
                      handleThresholdChange(assoc.configurationId, {
                        ...thresholds,
                        windowSize: Number.parseInt(e.target.value) || 10,
                      })
                    }
                    className="h-8 w-16 text-center"
                  />
                  <span className="text-xs text-muted-foreground">runs</span>
                </div>
              </div>
            </div>

            {/* Degraded Threshold */}
            <div className="p-3 rounded-lg border border-warning/30 bg-warning/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-warning" />
                  <span className="text-sm font-medium text-warning">
                    Degraded
                  </span>
                  <Tooltip content="System becomes degraded when failures in the window reach this count" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">≥</span>
                  <Input
                    type="number"
                    min={1}
                    value={thresholds.degraded.minFailureCount}
                    onChange={(e) =>
                      handleThresholdChange(assoc.configurationId, {
                        ...thresholds,
                        degraded: {
                          minFailureCount: Number.parseInt(e.target.value) || 1,
                        },
                      })
                    }
                    className="h-8 w-16 text-center"
                  />
                  <span className="text-xs text-muted-foreground">
                    failures
                  </span>
                </div>
              </div>
            </div>

            {/* Unhealthy Threshold */}
            <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-destructive" />
                  <span className="text-sm font-medium text-destructive">
                    Unhealthy
                  </span>
                  <Tooltip content="System becomes unhealthy when failures in the window reach this count" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">≥</span>
                  <Input
                    type="number"
                    min={1}
                    value={thresholds.unhealthy.minFailureCount}
                    onChange={(e) =>
                      handleThresholdChange(assoc.configurationId, {
                        ...thresholds,
                        unhealthy: {
                          minFailureCount: Number.parseInt(e.target.value) || 1,
                        },
                      })
                    }
                    className="h-8 w-16 text-center"
                  />
                  <span className="text-xs text-muted-foreground">
                    failures
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedPanel(undefined)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => handleSaveThresholds(assoc.configurationId)}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Thresholds"}
          </Button>
        </div>
      </div>
    );
  };

  const renderRetentionEditor = (configId: string) => {
    const data = retentionData[configId];

    if (!data) {
      return (
        <div className="mt-4 flex justify-center py-4">
          <LoadingSpinner />
        </div>
      );
    }

    // Validation
    const isValidHierarchy =
      data.rawRetentionDays < data.hourlyRetentionDays &&
      data.hourlyRetentionDays < data.dailyRetentionDays;

    return (
      <div className="mt-4 space-y-3">
        {!data.isCustom && (
          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Using default retention settings. Customize below to override.
          </div>
        )}

        {!isValidHierarchy && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
            Retention periods must increase: Raw &lt; Hourly &lt; Daily
          </div>
        )}

        {/* Raw Data */}
        <div className="p-3 rounded-lg border bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">Raw Data Retention</span>
              <p className="text-xs text-muted-foreground">
                Individual run data before hourly aggregation
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={30}
                value={data.rawRetentionDays}
                onChange={(e) =>
                  updateRetentionField(
                    configId,
                    "rawRetentionDays",
                    Number(e.target.value)
                  )
                }
                className="h-8 w-20 text-center"
              />
              <span className="text-sm text-muted-foreground w-10">days</span>
            </div>
          </div>
        </div>

        {/* Hourly Aggregates */}
        <div className="p-3 rounded-lg border bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">Hourly Aggregates</span>
              <p className="text-xs text-muted-foreground">
                Hourly stats before daily rollup
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={7}
                max={365}
                value={data.hourlyRetentionDays}
                onChange={(e) =>
                  updateRetentionField(
                    configId,
                    "hourlyRetentionDays",
                    Number(e.target.value)
                  )
                }
                className="h-8 w-20 text-center"
              />
              <span className="text-sm text-muted-foreground w-10">days</span>
            </div>
          </div>
        </div>

        {/* Daily Aggregates */}
        <div className="p-3 rounded-lg border bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">Daily Aggregates</span>
              <p className="text-xs text-muted-foreground">
                Long-term storage before deletion
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={30}
                max={1095}
                value={data.dailyRetentionDays}
                onChange={(e) =>
                  updateRetentionField(
                    configId,
                    "dailyRetentionDays",
                    Number(e.target.value)
                  )
                }
                className="h-8 w-20 text-center"
              />
              <span className="text-sm text-muted-foreground w-10">days</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-between pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleResetRetention(configId)}
            disabled={saving || !data.isCustom}
          >
            Reset to Defaults
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedPanel(undefined)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => handleSaveRetention(configId)}
              disabled={saving || !isValidHierarchy}
            >
              {saving ? "Saving..." : "Save Retention"}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="h-8 gap-1.5 border-dashed border-input hover:border-primary/30 hover:bg-primary/5"
      >
        <Activity className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium">Health Checks</span>
        {assignedIds.length > 0 && (
          <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
            {assignedIds.length}
          </span>
        )}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Health Check Assignments</DialogTitle>
            <DialogDescription className="sr-only">
              Manage health check assignments for this system
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : configs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4 italic">
              No health checks configured.
            </p>
          ) : (
            <div className="space-y-2">
              {configs.map((config) => {
                const assoc = associations.find(
                  (a) => a.configurationId === config.id
                );
                const isAssigned = !!assoc;
                const isExpanded =
                  selectedPanel?.configId === config.id &&
                  selectedPanel?.panel === "thresholds";
                const isRetentionExpanded =
                  selectedPanel?.configId === config.id &&
                  selectedPanel?.panel === "retention";

                return (
                  <div
                    key={config.id}
                    className="rounded-lg border bg-card p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={isAssigned}
                          onCheckedChange={() =>
                            handleToggleAssignment(config.id, isAssigned)
                          }
                          disabled={saving}
                        />
                        <div>
                          <div className="font-medium text-sm">
                            {config.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {config.strategyId} • every {config.intervalSeconds}
                            s
                          </div>
                        </div>
                      </div>
                      {isAssigned && (
                        <div className="flex items-center gap-1">
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                              className="h-7 px-2"
                            >
                              <Link
                                to={resolveRoute(
                                  healthcheckRoutes.routes.historyDetail,
                                  {
                                    systemId,
                                    configurationId: config.id,
                                  }
                                )}
                              >
                                <History className="h-4 w-4" />
                              </Link>
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSelectedPanel(
                                isExpanded
                                  ? undefined
                                  : { configId: config.id, panel: "thresholds" }
                              )
                            }
                            className="h-7 px-2"
                          >
                            <Settings2 className="h-4 w-4" />
                            <span className="ml-1 text-xs">Thresholds</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSelectedPanel(
                                isRetentionExpanded
                                  ? undefined
                                  : { configId: config.id, panel: "retention" }
                              )
                            }
                            className="h-7 px-2"
                          >
                            <Database className="h-4 w-4" />
                            <span className="ml-1 text-xs">Retention</span>
                          </Button>
                        </div>
                      )}
                    </div>
                    {isAssigned &&
                      isExpanded &&
                      assoc &&
                      renderThresholdEditor(assoc)}
                    {isAssigned &&
                      isRetentionExpanded &&
                      renderRetentionEditor(config.id)}
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
