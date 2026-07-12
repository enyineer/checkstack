import { useEffect, useMemo, useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { useToast, toastError, toastSuccess } from "@checkstack/ui";
import { HealthCheckApi } from "../api";
import { SatelliteApi } from "@checkstack/satellite-common";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  DEFAULT_STATE_THRESHOLDS,
  DEFAULT_NOTIFICATION_POLICY,
} from "@checkstack/healthcheck-common";
import type {
  NotificationPolicy,
  StateThresholds,
} from "@checkstack/healthcheck-common";
import {
  environmentIdsForMode,
  toggleEnvironmentId,
  type EnvironmentSelectorMode,
} from "../components/assignments/environment-selector.logic";
import {
  buildAssociationBody,
  resolveNotificationPolicyView,
  seedRetentionData,
  seedSpecificEnvironmentIds,
} from "../components/assignments/assignment-editor.logic";
import type { RetentionData } from "../components/assignments/RetentionPanel";
import type { AssignmentPanelKind } from "../components/assignments/assignment-node.logic";

/**
 * State + mutations for the check editor's Assignment section: one
 * CONFIGURATION, many systems. Inverse keying of the former system-centric
 * AssignmentIDEPage (which held one system, many configs) - all drafts are
 * keyed by systemId, and every write goes through the same
 * `associateSystem` full-body upsert / `disassociateSystem` /
 * `updateRetentionConfig` procedures as before.
 */
export function useAssignmentEditor({
  configId,
  activeSystemId,
  activePanel,
}: {
  configId: string;
  /** The system of the currently selected assignment node, if any. */
  activeSystemId: string | undefined;
  /** The selected assignment panel kind (drives lazy per-panel fetches). */
  activePanel: AssignmentPanelKind | undefined;
}) {
  const toast = useToast();
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const satelliteClient = usePluginClient(SatelliteApi);
  const catalogClient = usePluginClient(CatalogApi);

  // --- Data ---

  const {
    data: assignmentRows = [],
    isLoading: assignmentsLoading,
    isSuccess: assignmentsSettled,
    refetch: refetchAssignments,
  } = healthCheckClient.getConfigurationAssignments.useQuery(
    { configId },
    { enabled: !!configId },
  );

  const assignments = useMemo(
    () =>
      assignmentRows.toSorted((a, b) =>
        a.systemName.localeCompare(b.systemName, undefined, {
          sensitivity: "base",
        }),
      ),
    [assignmentRows],
  );

  const { data: satellitesData } = satelliteClient.listSatellites.useQuery(
    {},
    { enabled: !!configId },
  );
  const satellites = satellitesData?.satellites ?? [];

  // Platform notification defaults - the fallback for any assignment that
  // hasn't overridden them. A pure system manager cannot read them
  // (typeScoped on the healthcheck type); the view then falls back to
  // DEFAULT_NOTIFICATION_POLICY, exactly like the old page.
  const { data: platformDefaults } =
    healthCheckClient.getPlatformNotificationDefaults.useQuery(
      {},
      { enabled: !!configId },
    );

  // Environments of the ACTIVE system only - drives that assignment's
  // environment selector. Other systems' panels fetch when selected.
  const {
    data: systemEnvironments = [],
    isSuccess: systemEnvironmentsSettled,
    isLoading: systemEnvironmentsLoading,
  } = catalogClient.getSystemEnvironments.useQuery(
    { systemId: activeSystemId ?? "" },
    { enabled: !!activeSystemId },
  );

  // --- Drafts (keyed by systemId) ---

  const [localThresholds, setLocalThresholds] = useState<
    Record<string, StateThresholds>
  >({});
  const [localNotificationPolicy, setLocalNotificationPolicy] = useState<
    Record<string, NotificationPolicy>
  >({});
  const [retentionData, setRetentionData] = useState<
    Record<string, RetentionData>
  >({});

  // Retention is fetched lazily when its panel opens (and only once per
  // system - the local record then owns the edit state).
  const { data: retentionConfigData } =
    healthCheckClient.getRetentionConfig.useQuery(
      { systemId: activeSystemId ?? "", configurationId: configId },
      {
        enabled:
          activePanel === "retention" &&
          !!activeSystemId &&
          !retentionData[activeSystemId],
      },
    );

  useEffect(() => {
    if (
      retentionConfigData &&
      activeSystemId &&
      !retentionData[activeSystemId]
    ) {
      setRetentionData((prev) => ({
        ...prev,
        [activeSystemId]: seedRetentionData(
          retentionConfigData.retentionConfig,
        ),
      }));
    }
  }, [retentionConfigData, activeSystemId, retentionData]);

  // --- Mutations ---

  const associateMutation = healthCheckClient.associateSystem.useMutation({
    onSuccess: () => {
      void refetchAssignments();
    },
    onError: (error) => toastError(toast, "Failed to update", error),
  });

  const disassociateMutation = healthCheckClient.disassociateSystem.useMutation(
    {
      onSuccess: () => {
        toastSuccess(toast, "Health check unassigned");
        void refetchAssignments();
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

  // --- Helpers ---

  const findAssignment = (systemId: string) =>
    assignments.find((a) => a.systemId === systemId);

  /** Persist a partial patch of one assignment as a full-body upsert. */
  const patchAssignment = (
    systemId: string,
    patch: Parameters<typeof buildAssociationBody>[0]["patch"],
    onSuccess?: () => void,
  ) => {
    const assignment = findAssignment(systemId);
    if (!assignment) return;
    associateMutation.mutate(
      {
        systemId,
        body: buildAssociationBody({
          configurationId: configId,
          assignment,
          patch,
        }),
      },
      onSuccess ? { onSuccess } : undefined,
    );
  };

  // --- Handlers ---

  const assign = (systemId: string, onSuccess?: () => void) => {
    associateMutation.mutate(
      {
        systemId,
        body: {
          configurationId: configId,
          enabled: true,
          stateThresholds: DEFAULT_STATE_THRESHOLDS,
          includeLocal: true,
        },
      },
      onSuccess ? { onSuccess } : undefined,
    );
  };

  const unassign = (systemId: string, onSuccess?: () => void) => {
    disassociateMutation.mutate(
      { systemId, configId },
      onSuccess ? { onSuccess } : undefined,
    );
  };

  const toggleEnabled = (systemId: string) => {
    const assignment = findAssignment(systemId);
    if (!assignment) return;
    patchAssignment(systemId, { enabled: !assignment.enabled });
  };

  const changeThresholds = (systemId: string, thresholds: StateThresholds) => {
    setLocalThresholds((prev) => ({ ...prev, [systemId]: thresholds }));
  };

  const saveThresholds = (systemId: string) => {
    const assignment = findAssignment(systemId);
    if (!assignment) return;
    const thresholds =
      localThresholds[systemId] ?? assignment.stateThresholds;
    patchAssignment(systemId, { stateThresholds: thresholds }, () => {
      toastSuccess(toast, "Thresholds saved");
      setLocalThresholds((prev) => {
        const next = { ...prev };
        delete next[systemId];
        return next;
      });
    });
  };

  const thresholdsFor = (systemId: string): StateThresholds =>
    localThresholds[systemId] ??
    findAssignment(systemId)?.stateThresholds ??
    DEFAULT_STATE_THRESHOLDS;

  const changeNotificationPolicy = (
    systemId: string,
    policy: NotificationPolicy,
  ) => {
    setLocalNotificationPolicy((prev) => ({ ...prev, [systemId]: policy }));
  };

  const saveNotificationPolicy = (systemId: string) => {
    const assignment = findAssignment(systemId);
    if (!assignment) return;
    const policy =
      localNotificationPolicy[systemId] ??
      assignment.notificationPolicy ??
      platformDefaults ??
      DEFAULT_NOTIFICATION_POLICY;
    patchAssignment(systemId, { notificationPolicy: policy }, () => {
      toastSuccess(toast, "Notification policy saved");
      setLocalNotificationPolicy((prev) => {
        const next = { ...prev };
        delete next[systemId];
        return next;
      });
    });
  };

  /**
   * Revert this assignment to platform defaults: persists an undefined
   * `notificationPolicy` (stored as null, re-resolving to the defaults).
   */
  const useDefaultsForAssignment = (systemId: string) => {
    patchAssignment(systemId, { notificationPolicy: undefined }, () => {
      toastSuccess(toast, "Reverted to platform defaults");
      setLocalNotificationPolicy((prev) => {
        const next = { ...prev };
        delete next[systemId];
        return next;
      });
    });
  };

  /**
   * Start customising - clones the current platform defaults into the draft
   * so the operator has a baseline to edit; the panel's Save persists it.
   */
  const overrideForAssignment = (systemId: string) => {
    const baseline = platformDefaults ?? DEFAULT_NOTIFICATION_POLICY;
    setLocalNotificationPolicy((prev) => ({ ...prev, [systemId]: baseline }));
  };

  const notificationViewFor = (systemId: string) =>
    resolveNotificationPolicyView({
      draft: localNotificationPolicy[systemId],
      persisted: findAssignment(systemId)?.notificationPolicy,
      platformDefaults,
    });

  const toggleSatellite = (systemId: string, satelliteId: string) => {
    const assignment = findAssignment(systemId);
    if (!assignment) return;
    const currentIds = assignment.satelliteIds ?? [];
    const nextIds = currentIds.includes(satelliteId)
      ? currentIds.filter((id) => id !== satelliteId)
      : [...currentIds, satelliteId];
    patchAssignment(systemId, { satelliteIds: nextIds });
  };

  const toggleLocal = (systemId: string) => {
    const assignment = findAssignment(systemId);
    if (!assignment) return;
    patchAssignment(systemId, { includeLocal: !assignment.includeLocal });
  };

  const setEnvironmentMode = (
    systemId: string,
    mode: EnvironmentSelectorMode,
  ) => {
    const assignment = findAssignment(systemId);
    if (!assignment) return;
    const currentSpecific = seedSpecificEnvironmentIds({
      environmentIds: assignment.environmentIds,
      systemEnvironmentIds: systemEnvironments.map((e) => e.id),
    });
    patchAssignment(systemId, {
      environmentIds: environmentIdsForMode({
        mode,
        selectedIds: currentSpecific,
      }),
    });
  };

  const toggleEnvironment = (systemId: string, environmentId: string) => {
    const assignment = findAssignment(systemId);
    if (!assignment) return;
    const currentSpecific =
      assignment.environmentIds && assignment.environmentIds.length > 0
        ? assignment.environmentIds
        : [];
    patchAssignment(systemId, {
      environmentIds: toggleEnvironmentId({
        selectedIds: currentSpecific,
        environmentId,
      }),
    });
  };

  const changeRetentionField = (
    systemId: string,
    field: string,
    value: number,
  ) => {
    setRetentionData((prev) => ({
      ...prev,
      [systemId]: { ...prev[systemId], [field]: value, isCustom: true },
    }));
  };

  const saveRetention = (systemId: string) => {
    const data = retentionData[systemId];
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

  const resetRetention = (systemId: string) => {
    updateRetentionMutation.mutate(
      { systemId, configurationId: configId, retentionConfig: null },
      {
        onSuccess: () => {
          setRetentionData((prev) => ({
            ...prev,
            [systemId]: seedRetentionData(null),
          }));
          toastSuccess(toast, "Reset to defaults");
        },
      },
    );
  };

  return {
    assignments,
    assignmentsLoading,
    assignmentsSettled,
    satellites,
    platformDefaults,
    systemEnvironments,
    systemEnvironmentsSettled,
    systemEnvironmentsLoading,
    saving,
    assign,
    unassign,
    toggleEnabled,
    thresholdsFor,
    changeThresholds,
    saveThresholds,
    notificationViewFor,
    changeNotificationPolicy,
    saveNotificationPolicy,
    useDefaultsForAssignment,
    overrideForAssignment,
    toggleSatellite,
    toggleLocal,
    setEnvironmentMode,
    toggleEnvironment,
    retentionDataFor: (systemId: string) => retentionData[systemId],
    changeRetentionField,
    saveRetention,
    resetRetention,
  };
}

export type AssignmentEditor = ReturnType<typeof useAssignmentEditor>;
