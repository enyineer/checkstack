import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  usePluginClient,
  wrapInSuspense,
  ExtensionSlot,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";
import { SatelliteApi } from "@checkstack/satellite-common";
import {
  DEFAULT_STATE_THRESHOLDS,
  DEFAULT_RETENTION_CONFIG,
  DEFAULT_NOTIFICATION_POLICY,
} from "@checkstack/healthcheck-common";
import type {
  StateThresholds,
  NotificationPolicy,
} from "@checkstack/healthcheck-common";
import {
  PageLayout,
  IDELayout,
  useToast,
  toastError,
  toastSuccess,
  BackLink,
  Button,
} from "@checkstack/ui";
import { Settings, Plus, Bell } from "lucide-react";
import { resolveRoute } from "@checkstack/common";
import {
  catalogRoutes,
  CatalogApi,
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import {
  environmentIdsForMode,
  toggleEnvironmentId,
  type EnvironmentSelectorMode,
} from "../components/assignments/environment-selector.logic";
import { healthcheckRoutes } from "@checkstack/healthcheck-common";
import {
  AssignmentTree,
  type AssignmentNodeId,
} from "../components/assignments/AssignmentTree";
import { GeneralPanel } from "../components/assignments/GeneralPanel";
import { ThresholdsPanel } from "../components/assignments/ThresholdsPanel";
import { useProvenanceLock, GitOpsLockBanner } from "@checkstack/gitops-frontend";
import {
  RetentionPanel,
  type RetentionData,
} from "../components/assignments/RetentionPanel";
import { ExecutionPanel } from "../components/assignments/ExecutionPanel";
import { NotificationsPanel } from "../components/assignments/NotificationsPanel";
import { PlatformDefaultsDialog } from "../components/assignments/PlatformDefaultsDialog";
import { AssignmentIDEPanelSlot } from "../slots";

// =============================================================================
// HELPERS
// =============================================================================

function parseNodeId(nodeId: AssignmentNodeId): {
  panel:
    | "general"
    | "thresholds"
    | "retention"
    | "execution"
    | "notifications";
  configId: string;
} {
  const [panel, ...rest] = nodeId.split(":") as [string, ...string[]];
  return {
    panel: panel as
      | "general"
      | "thresholds"
      | "retention"
      | "execution"
      | "notifications",
    configId: rest.join(":"),
  };
}

// =============================================================================
// PAGE
// =============================================================================

const AssignmentIDEPageContent = () => {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const satelliteClient = usePluginClient(SatelliteApi);
  const catalogClient = usePluginClient(CatalogApi);

  // --- Data Fetching ---

  const { data: configurationsData, isLoading: configsLoading } =
    healthCheckClient.getConfigurations.useQuery({});

  const { data: associations = [], refetch: refetchAssociations } =
    healthCheckClient.getSystemAssociations.useQuery(
      { systemId: systemId ?? "" },
      { enabled: !!systemId },
    );

  const { isLocked, provenance } = useProvenanceLock({
    kind: "System",
    entityId: systemId,
  });

  // Assigning/unassigning health checks requires MANAGE on the target system
  // (enforced backend-side by `associateSystem` / `createAndAssign`). Users who
  // can reach this page via feature-level config access but do not manage the
  // system get a read-only surface: no assign/unassign, no create.
  const accessApi = useApi(accessApiRef);
  const { canAccess: canManageSystem } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: systemId ? [systemId] : [],
  });
  const canManage = systemId ? canManageSystem(systemId) : false;
  // Any write surface is disabled when GitOps-locked OR the user cannot manage
  // the system.
  const readOnly = isLocked || !canManage;

  const { data: satellitesData } = satelliteClient.listSatellites.useQuery({});

  // Environments the system currently belongs to — drives the per-assignment
  // environment selector (the fan-out set is a subset of these).
  const { data: systemEnvironments = [] } =
    catalogClient.getSystemEnvironments.useQuery(
      { systemId: systemId ?? "" },
      { enabled: !!systemId },
    );

  // --- UI State ---

  const [selectedNode, setSelectedNode] = useState<AssignmentNodeId>();
  const [localThresholds, setLocalThresholds] = useState<
    Record<string, StateThresholds>
  >({});
  const [retentionData, setRetentionData] = useState<
    Record<string, RetentionData>
  >({});
  const [localNotificationPolicy, setLocalNotificationPolicy] = useState<
    Record<string, NotificationPolicy>
  >({});
  const [platformDefaultsOpen, setPlatformDefaultsOpen] = useState(false);

  // Platform notification defaults — used as the fallback for any
  // assignment that hasn't overridden them. Refetched whenever the
  // platform-defaults dialog closes so changes propagate immediately.
  const { data: platformDefaults } =
    healthCheckClient.getPlatformNotificationDefaults.useQuery();

  const configs = useMemo(
    () => configurationsData?.configurations ?? [],
    [configurationsData],
  );
  const satellites = satellitesData?.satellites ?? [];
  const assignedIds = useMemo(
    () => new Set(associations.map((a) => a.configurationId)),
    [associations],
  );

  // Fetch retention for selected config
  const selectedConfigId = selectedNode
    ? parseNodeId(selectedNode).configId
    : undefined;
  const isRetentionPanel = selectedNode?.startsWith("retention:");

  const { data: retentionConfigData } =
    healthCheckClient.getRetentionConfig.useQuery(
      {
        systemId: systemId ?? "",
        configurationId: selectedConfigId ?? "",
      },
      {
        enabled:
          !!isRetentionPanel &&
          !!selectedConfigId &&
          !retentionData[selectedConfigId],
      },
    );

  useEffect(() => {
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

  // --- Auto-select first node ---

  useEffect(() => {
    if (!selectedNode && associations.length > 0) {
      setSelectedNode(`general:${associations[0].configurationId}`);
    }
  }, [selectedNode, associations]);

  // --- Mutations ---

  const associateMutation = healthCheckClient.associateSystem.useMutation({
    onSuccess: () => {
      void refetchAssociations();
    },
    onError: (error) => toastError(toast, "Failed to update", error),
  });

  const disassociateMutation = healthCheckClient.disassociateSystem.useMutation(
    {
      onSuccess: () => {
        toastSuccess(toast, "Health check unassigned");
        void refetchAssociations();
      },
      onError: (error) => toastError(toast, "Failed to update", error),
    },
  );

  const updateRetentionMutation =
    healthCheckClient.updateRetentionConfig.useMutation({
      onSuccess: () => {
        toastSuccess(toast, "Retention settings saved");
      },
      onError: (error) => toastError(toast, "Failed to save", error),
    });

  const saving =
    associateMutation.isPending ||
    disassociateMutation.isPending ||
    updateRetentionMutation.isPending;

  // --- Handlers ---

  const handleToggleAssignment = (configId: string, isAssigned: boolean) => {
    if (!systemId) return;

    if (isAssigned) {
      disassociateMutation.mutate({ systemId, configId });
      if (selectedNode && parseNodeId(selectedNode).configId === configId) {
        setSelectedNode(undefined);
      }
    } else {
      associateMutation.mutate({
        systemId,
        body: {
          configurationId: configId,
          enabled: true,
          stateThresholds: DEFAULT_STATE_THRESHOLDS,
          includeLocal: true,
        },
      });
    }
  };

  const handleToggleEnabled = (configId: string, currentEnabled: boolean) => {
    if (!systemId) return;
    const assoc = associations.find((a) => a.configurationId === configId);
    if (!assoc) return;

    associateMutation.mutate({
      systemId,
      body: {
        configurationId: configId,
        enabled: !currentEnabled,
        stateThresholds: assoc.stateThresholds,
        satelliteIds: assoc.satelliteIds,
        environmentIds: assoc.environmentIds,
        includeLocal: assoc.includeLocal,
        notificationPolicy: assoc.notificationPolicy,
      },
    });
  };

  const handleThresholdChange = (
    configId: string,
    thresholds: StateThresholds,
  ) => {
    setLocalThresholds((prev) => ({ ...prev, [configId]: thresholds }));
  };

  const handleSaveThresholds = (configId: string) => {
    if (!systemId) return;
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
          satelliteIds: assoc.satelliteIds,
          environmentIds: assoc.environmentIds,
          includeLocal: assoc.includeLocal,
          notificationPolicy: assoc.notificationPolicy,
        },
      },
      {
        onSuccess: () => {
          toastSuccess(toast, "Thresholds saved");
          setLocalThresholds((prev) => {
            const next = { ...prev };
            delete next[configId];
            return next;
          });
        },
      },
    );
  };

  const handleNotificationPolicyChange = (
    configId: string,
    policy: NotificationPolicy,
  ) => {
    setLocalNotificationPolicy((prev) => ({ ...prev, [configId]: policy }));
  };

  const handleSaveNotificationPolicy = (configId: string) => {
    if (!systemId) return;
    const assoc = associations.find((a) => a.configurationId === configId);
    if (!assoc) return;
    const policy =
      localNotificationPolicy[configId] ??
      assoc.notificationPolicy ??
      platformDefaults ??
      DEFAULT_NOTIFICATION_POLICY;

    associateMutation.mutate(
      {
        systemId,
        body: {
          configurationId: configId,
          enabled: assoc.enabled,
          stateThresholds: assoc.stateThresholds,
          satelliteIds: assoc.satelliteIds,
          environmentIds: assoc.environmentIds,
          includeLocal: assoc.includeLocal,
          notificationPolicy: policy,
        },
      },
      {
        onSuccess: () => {
          toastSuccess(toast, "Notification policy saved");
          setLocalNotificationPolicy((prev) => {
            const next = { ...prev };
            delete next[configId];
            return next;
          });
        },
      },
    );
  };

  /**
   * Revert this assignment to platform defaults. Sends an undefined
   * `notificationPolicy` which is persisted as null and re-resolves to
   * the platform defaults on the next read.
   */
  const handleUseDefaultsForAssignment = (configId: string) => {
    if (!systemId) return;
    const assoc = associations.find((a) => a.configurationId === configId);
    if (!assoc) return;

    associateMutation.mutate(
      {
        systemId,
        body: {
          configurationId: configId,
          enabled: assoc.enabled,
          stateThresholds: assoc.stateThresholds,
          satelliteIds: assoc.satelliteIds,
          environmentIds: assoc.environmentIds,
          includeLocal: assoc.includeLocal,
          notificationPolicy: undefined,
        },
      },
      {
        onSuccess: () => {
          toastSuccess(toast, "Reverted to platform defaults");
          setLocalNotificationPolicy((prev) => {
            const next = { ...prev };
            delete next[configId];
            return next;
          });
        },
      },
    );
  };

  /**
   * Start customising — clone the current platform defaults into the
   * draft state so the operator has a baseline to edit, then persist.
   * The persistence step is what flips the row out of "inherit" mode.
   */
  const handleOverrideForAssignment = (configId: string) => {
    const baseline = platformDefaults ?? DEFAULT_NOTIFICATION_POLICY;
    setLocalNotificationPolicy((prev) => ({ ...prev, [configId]: baseline }));
    // Defer the actual save: operators may want to tweak the cloned
    // baseline before persisting. The Save button at the bottom of
    // the panel handles it.
  };

  const handleToggleSatellite = (configId: string, satelliteId: string) => {
    if (!systemId) return;
    const assoc = associations.find((a) => a.configurationId === configId);
    if (!assoc) return;

    const currentIds = assoc.satelliteIds ?? [];
    const isAssigned = currentIds.includes(satelliteId);
    const newIds = isAssigned
      ? currentIds.filter((id) => id !== satelliteId)
      : [...currentIds, satelliteId];

    associateMutation.mutate({
      systemId,
      body: {
        configurationId: configId,
        enabled: assoc.enabled,
        stateThresholds: assoc.stateThresholds,
        satelliteIds: newIds,
        environmentIds: assoc.environmentIds,
        includeLocal: assoc.includeLocal,
        notificationPolicy: assoc.notificationPolicy,
      },
    });
  };

  const handleToggleLocal = (configId: string) => {
    if (!systemId) return;
    const assoc = associations.find((a) => a.configurationId === configId);
    if (!assoc) return;

    associateMutation.mutate({
      systemId,
      body: {
        configurationId: configId,
        enabled: assoc.enabled,
        stateThresholds: assoc.stateThresholds,
        satelliteIds: assoc.satelliteIds,
        environmentIds: assoc.environmentIds,
        includeLocal: !assoc.includeLocal,
        notificationPolicy: assoc.notificationPolicy,
      },
    });
  };

  /**
   * Persist `environmentIds` for an assignment, preserving every other
   * operator-managed field. Used by both the mode switch and the per-env
   * toggle in the "specific" mode.
   */
  const persistEnvironmentIds = (
    configId: string,
    environmentIds: string[] | null,
  ) => {
    if (!systemId) return;
    const assoc = associations.find((a) => a.configurationId === configId);
    if (!assoc) return;

    associateMutation.mutate({
      systemId,
      body: {
        configurationId: configId,
        enabled: assoc.enabled,
        stateThresholds: assoc.stateThresholds,
        satelliteIds: assoc.satelliteIds,
        environmentIds,
        includeLocal: assoc.includeLocal,
        notificationPolicy: assoc.notificationPolicy,
      },
    });
  };

  const handleSetEnvironmentMode = (
    configId: string,
    mode: EnvironmentSelectorMode,
  ) => {
    const assoc = associations.find((a) => a.configurationId === configId);
    // Switching to "specific" seeds with the current explicit set if any,
    // otherwise all current environment ids (a sensible starting point).
    const currentSpecific =
      assoc?.environmentIds && assoc.environmentIds.length > 0
        ? assoc.environmentIds
        : systemEnvironments.map((e) => e.id);
    persistEnvironmentIds(
      configId,
      environmentIdsForMode({ mode, selectedIds: currentSpecific }),
    );
  };

  const handleToggleEnvironment = (configId: string, environmentId: string) => {
    const assoc = associations.find((a) => a.configurationId === configId);
    const currentSpecific =
      assoc?.environmentIds && assoc.environmentIds.length > 0
        ? assoc.environmentIds
        : [];
    persistEnvironmentIds(
      configId,
      toggleEnvironmentId({ selectedIds: currentSpecific, environmentId }),
    );
  };

  const handleSaveRetention = (configId: string) => {
    if (!systemId) return;
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
    if (!systemId) return;
    updateRetentionMutation.mutate(
      {
        systemId,
        configurationId: configId,
         
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
          toastSuccess(toast, "Reset to defaults");
        },
      },
    );
  };

  const updateRetentionField = (
    configId: string,
    field: string,
    value: number,
  ) => {
    setRetentionData((prev) => ({
      ...prev,
      [configId]: { ...prev[configId], [field]: value, isCustom: true },
    }));
  };

  // --- Derived Data ---

  const assignedConfigs = useMemo(
    () =>
      associations
        .map((assoc) => ({
          configurationId: assoc.configurationId,
          configurationName: assoc.configurationName,
          enabled: assoc.enabled,
          satelliteCount: assoc.satelliteIds?.length ?? 0,
        }))
        .toSorted((a, b) =>
          a.configurationName.localeCompare(b.configurationName),
        ),
    [associations],
  );

  const availableConfigs = useMemo(
    () =>
      configs
        .filter((c) => !assignedIds.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, strategyId: c.strategyId }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    [configs, assignedIds],
  );

  // --- Render Panel ---

  const renderPanel = () => {
    if (!selectedNode) {
      if (associations.length === 0) {
        return (
          <div className="flex h-full items-center justify-center p-12">
            <div className="max-w-md space-y-2 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                Assign this check to a system to start it
              </p>
              <p>
                An assignment links a health check to a system. A check does not
                run until it is assigned - assigning is what schedules it. The
                assignment also carries per-system settings (failure thresholds,
                notifications) and runs the check once per environment the system
                belongs to.
              </p>
              <p>Add a system from the left panel to get started.</p>
            </div>
          </div>
        );
      }
      return (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-12">
          Select an item from the left panel to configure it.
        </div>
      );
    }

    const { panel, configId } = parseNodeId(selectedNode);
    const assoc = associations.find((a) => a.configurationId === configId);
    if (!assoc) return;

    switch (panel) {
      case "general": {
        return (
          <GeneralPanel
            configurationName={assoc.configurationName}
            strategyId={
              configs.find((c) => c.id === configId)?.strategyId ?? ""
            }
            configurationId={configId}
            enabled={assoc.enabled}
            onToggleEnabled={() => handleToggleEnabled(configId, assoc.enabled)}
            onUnassign={() => handleToggleAssignment(configId, true)}
            saving={saving}
            isLocked={readOnly}
          />
        );
      }
      case "thresholds": {
        const thresholds =
          localThresholds[configId] ??
          assoc.stateThresholds ??
          DEFAULT_STATE_THRESHOLDS;
        return (
          <ThresholdsPanel
            thresholds={thresholds}
            onChange={(t) => handleThresholdChange(configId, t)}
            onSave={() => handleSaveThresholds(configId)}
            saving={saving}
            isLocked={readOnly}
          />
        );
      }
      case "retention": {
        return (
          <RetentionPanel
            data={retentionData[configId]}
            onFieldChange={(field, value) =>
              updateRetentionField(configId, field, value)
            }
            onSave={() => handleSaveRetention(configId)}
            onReset={() => handleResetRetention(configId)}
            saving={saving}
            isLocked={readOnly}
          />
        );
      }
      case "execution": {
        return (
          <ExecutionPanel
            includeLocal={assoc.includeLocal}
            satelliteIds={assoc.satelliteIds ?? []}
            satellites={satellites}
            onToggleLocal={() => handleToggleLocal(configId)}
            onToggleSatellite={(satId) =>
              handleToggleSatellite(configId, satId)
            }
            environmentIds={assoc.environmentIds ?? null}
            environments={systemEnvironments.map((e) => ({
              id: e.id,
              name: e.name,
            }))}
            onSetEnvironmentMode={(mode) =>
              handleSetEnvironmentMode(configId, mode)
            }
            onToggleEnvironment={(envId) =>
              handleToggleEnvironment(configId, envId)
            }
            saving={saving}
            isLocked={readOnly}
          />
        );
      }
      case "notifications": {
        // Is the operator actively editing a draft? Drafts are stored
        // when override starts, so the presence of a draft AND the
        // assignment being persisted-as-override mean the same thing.
        const draft = localNotificationPolicy[configId];
        const isOverridden =
          draft !== undefined || assoc.notificationPolicy !== undefined;
        const policy =
          draft ??
          assoc.notificationPolicy ??
          platformDefaults ??
          DEFAULT_NOTIFICATION_POLICY;
        return (
          <NotificationsPanel
            policy={policy}
            onChange={(p) => handleNotificationPolicyChange(configId, p)}
            onSave={() => handleSaveNotificationPolicy(configId)}
            saving={saving}
            isLocked={readOnly}
            isOverridden={isOverridden}
            onOverride={() => handleOverrideForAssignment(configId)}
            onUseDefaults={() => handleUseDefaultsForAssignment(configId)}
          />
        );
      }
      default: {
        return (
          <ExtensionSlot 
            slot={AssignmentIDEPanelSlot} 
            context={{
              systemId: systemId ?? "",
              configurationId: configId,
              selectedNode,
              onSelectNode: setSelectedNode,
              isLocked: readOnly
            }}
          />
        );
      }
    }
  };

  if (configsLoading) {
    return (
      <PageLayout title="Health Check Assignments" icon={Settings} loading>
        <div />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Health Check Assignments"
      icon={Settings}
      maxWidth="full"
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPlatformDefaultsOpen(true)}
          >
            <Bell className="mr-2 h-4 w-4" />
            Notification defaults
          </Button>
          {!readOnly && systemId && (
            <Button
              size="sm"
              onClick={() =>
                navigate(
                  `${resolveRoute(healthcheckRoutes.routes.create)}?systemId=${encodeURIComponent(systemId)}`,
                )
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Create new check
            </Button>
          )}
          <BackLink
            onClick={() => navigate(resolveRoute(catalogRoutes.routes.config))}
          >
            Back to Systems
          </BackLink>
        </div>
      }
    >
      {isLocked && provenance && (
        <div className="mb-4">
          <GitOpsLockBanner provenance={provenance} />
        </div>
      )}
      <IDELayout
        tree={
          <AssignmentTree
            systemId={systemId ?? ""}
            assigned={assignedConfigs}
            available={availableConfigs}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            onToggleAssignment={handleToggleAssignment}
            isLocked={readOnly}
          />
        }
        panel={renderPanel()}
      />
      <PlatformDefaultsDialog
        open={platformDefaultsOpen}
        onOpenChange={setPlatformDefaultsOpen}
      />
    </PageLayout>
  );
};

export const AssignmentIDEPage = wrapInSuspense(AssignmentIDEPageContent);
