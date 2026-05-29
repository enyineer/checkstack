import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePluginClient, wrapInSuspense, ExtensionSlot } from "@checkstack/frontend-api";
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
import { PageLayout, IDELayout, useToast, BackLink, Button } from "@checkstack/ui";
import { Settings, Plus } from "lucide-react";
import { extractErrorMessage, resolveRoute } from "@checkstack/common";
import { catalogRoutes } from "@checkstack/catalog-common";
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

  const { data: satellitesData } = satelliteClient.listSatellites.useQuery({});

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
    onError: (error) =>
      toast.error(extractErrorMessage(error, "Failed to update")),
  });

  const disassociateMutation = healthCheckClient.disassociateSystem.useMutation(
    {
      onSuccess: () => {
          toast.success("Health check unassigned");
        void refetchAssociations();
      },
      onError: (error) =>
        toast.error(extractErrorMessage(error, "Failed to update")),
    },
  );

  const updateRetentionMutation =
    healthCheckClient.updateRetentionConfig.useMutation({
      onSuccess: () => {
        toast.success("Retention settings saved");
      },
      onError: (error) =>
        toast.error(extractErrorMessage(error, "Failed to save")),
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
          includeLocal: assoc.includeLocal,
          notificationPolicy: assoc.notificationPolicy,
        },
      },
      {
        onSuccess: () => {
          toast.success("Thresholds saved");
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
      DEFAULT_NOTIFICATION_POLICY;

    associateMutation.mutate(
      {
        systemId,
        body: {
          configurationId: configId,
          enabled: assoc.enabled,
          stateThresholds: assoc.stateThresholds,
          satelliteIds: assoc.satelliteIds,
          includeLocal: assoc.includeLocal,
          notificationPolicy: policy,
        },
      },
      {
        onSuccess: () => {
          toast.success("Notification policy saved");
          setLocalNotificationPolicy((prev) => {
            const next = { ...prev };
            delete next[configId];
            return next;
          });
        },
      },
    );
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
        includeLocal: !assoc.includeLocal,
        notificationPolicy: assoc.notificationPolicy,
      },
    });
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
          toast.success("Reset to defaults");
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
      return (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-12">
          {associations.length === 0
            ? "Add a health check from the left panel to get started."
            : "Select an item from the left panel to configure it."}
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
            isLocked={isLocked}
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
            isLocked={isLocked}
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
            isLocked={isLocked}
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
            saving={saving}
            isLocked={isLocked}
          />
        );
      }
      case "notifications": {
        const policy =
          localNotificationPolicy[configId] ??
          assoc.notificationPolicy ??
          DEFAULT_NOTIFICATION_POLICY;
        return (
          <NotificationsPanel
            policy={policy}
            onChange={(p) => handleNotificationPolicyChange(configId, p)}
            onSave={() => handleSaveNotificationPolicy(configId)}
            saving={saving}
            isLocked={isLocked}
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
              isLocked
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
          {!isLocked && systemId && (
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
            isLocked={isLocked}
          />
        }
        panel={renderPanel()}
      />
    </PageLayout>
  );
};

export const AssignmentIDEPage = wrapInSuspense(AssignmentIDEPageContent);
