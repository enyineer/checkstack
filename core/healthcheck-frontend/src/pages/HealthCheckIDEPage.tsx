import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  usePluginClient,
  wrapInSuspense,
  ExtensionSlot,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";
import { HealthCheckConfigIDEPanelSlot } from "../slots";
import {
  healthcheckRoutes,
  type CollectorConfigEntry,
  DEFAULT_STATE_THRESHOLDS,
} from "@checkstack/healthcheck-common";
import { CatalogApi } from "@checkstack/catalog-common";
import { PageLayout, Button, useToast, IDELayout, type ValidationIssue } from "@checkstack/ui";
import { Save, Settings } from "lucide-react";
import { resolveRoute, extractErrorMessage} from "@checkstack/common";
import { useCollectors } from "../hooks/useCollectors";
import { EditorTree, type TreeNodeId } from "../components/editor/EditorTree";
import { EditorPanel } from "../components/editor/EditorPanel";
import { useProvenanceLock, GitOpsLockBanner } from "@checkstack/gitops-frontend";


// =============================================================================
// TYPES
// =============================================================================

interface EditorFormState {
  name: string;
  intervalSeconds: number;
  strategyConfig: Record<string, unknown>;
  collectors: CollectorConfigEntry[];
}

// =============================================================================
// PAGE COMPONENT
// =============================================================================

const HealthCheckIDEPageContent = () => {
  const { configId } = useParams<{ configId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const healthCheckClient = usePluginClient(HealthCheckApi);

  const isEditMode = !!configId && configId !== "new";
  const strategyIdFromUrl = searchParams.get("strategy") ?? undefined;
  const systemIdFromUrl = searchParams.get("systemId") ?? undefined;
  const catalogClient = usePluginClient(CatalogApi);

  // --- GitOps Provenance Lock ---
  const { isLocked, provenance } = useProvenanceLock({
    kind: "Healthcheck",
    entityId: isEditMode ? configId : undefined,
  });

  // --- Data Fetching ---

  // Fetch all strategies (needed for both modes)
  const { data: strategies = [] } = healthCheckClient.getStrategies.useQuery(
    {},
  );

  // Fetch single configuration for edit mode
  const { data: existingConfig, isLoading: configLoading } =
    healthCheckClient.getConfiguration.useQuery(
      { id: configId ?? "" },
      { enabled: isEditMode },
    );

  // Determine the active strategy ID
  const activeStrategyId = isEditMode
    ? existingConfig?.strategyId
    : strategyIdFromUrl;

  const activeStrategy = useMemo(
    () => strategies.find((s) => s.id === activeStrategyId),
    [strategies, activeStrategyId],
  );

  // Fetch collectors for the active strategy
  const { collectors: availableCollectors, loading: collectorsLoading } =
    useCollectors(activeStrategyId ?? "");

  // Fetch systems for assignment (only in create mode)
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({}, { enabled: !isEditMode });
  const systems = useMemo(
    () =>
      (systemsData?.systems ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
    [systemsData],
  );

  // --- Form State ---

  const [formState, setFormState] = useState<EditorFormState>({
    name: "",
    intervalSeconds: 60,
    strategyConfig: {},
    collectors: [],
  });

  const [selectedNode, setSelectedNode] = useState<TreeNodeId>("general");
  const [strategyConfigValid, setStrategyConfigValid] = useState(true);
  const [collectorsValidity, setCollectorsValidity] = useState<
    Record<string, boolean>
  >({});
  const [isDirty, setIsDirty] = useState(false);
  const [selectedSystemIds, setSelectedSystemIds] = useState<string[]>(
    systemIdFromUrl ? [systemIdFromUrl] : [],
  );

  // Initialize form from existing configuration (edit mode)
  useEffect(() => {
    if (existingConfig) {
      setFormState({
        name: existingConfig.name,
        intervalSeconds: existingConfig.intervalSeconds,
        strategyConfig: existingConfig.config,
        collectors: existingConfig.collectors ?? [],
      });
    }
  }, [existingConfig]);

  // Unsaved changes guard
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // --- Update Handlers ---

  const updateField = useCallback(
    <K extends keyof EditorFormState>(field: K, value: EditorFormState[K]) => {
      setFormState((prev) => ({ ...prev, [field]: value }));
      setIsDirty(true);
    },
    [],
  );

  const handleCollectorAdd = useCallback(
    (collectorId: string) => {
      const collector = availableCollectors.find((c) => c.id === collectorId);
      if (!collector) return;

      const newEntry: CollectorConfigEntry = {
        id: crypto.randomUUID(),
        collectorId,
        config: {},
        assertions: [],
      };

      setFormState((prev) => ({
        ...prev,
        collectors: [...prev.collectors, newEntry],
      }));
      setIsDirty(true);

      // Select the new collector in the tree
      setSelectedNode(`collector:${newEntry.id}`);
    },
    [availableCollectors],
  );

  const handleCollectorRemove = useCallback(
    (collectorEntryId: string) => {
      setFormState((prev) => ({
        ...prev,
        collectors: prev.collectors.filter((c) => c.id !== collectorEntryId),
      }));
      setIsDirty(true);

      // Navigate back to general if removing the selected collector
      if (selectedNode === `collector:${collectorEntryId}`) {
        setSelectedNode("general");
      }
    },
    [selectedNode],
  );

  const handleCollectorConfigChange = useCallback(
    (collectorEntryId: string, config: Record<string, unknown>) => {
      setFormState((prev) => ({
        ...prev,
        collectors: prev.collectors.map((c) =>
          c.id === collectorEntryId ? { ...c, config } : c,
        ),
      }));
      setIsDirty(true);
    },
    [],
  );

  const handleCollectorAssertionsChange = useCallback(
    (collectorEntryId: string, assertions: CollectorConfigEntry["assertions"]) => {
      setFormState((prev) => ({
        ...prev,
        collectors: prev.collectors.map((c) =>
          c.id === collectorEntryId ? { ...c, assertions } : c,
        ),
      }));
      setIsDirty(true);
    },
    [],
  );

  const handleCollectorValidChange = useCallback(
    (collectorEntryId: string, isValid: boolean) => {
      setCollectorsValidity((prev) => ({ ...prev, [collectorEntryId]: isValid }));
    },
    [],
  );

  // --- Validation ---

  const validationIssues = useMemo<ValidationIssue[]>(() => {
    const issues: ValidationIssue[] = [];

    if (!formState.name.trim()) {
      issues.push({ nodeId: "general", message: "Name is required" });
    }

    if (formState.intervalSeconds < 1) {
      issues.push({
        nodeId: "general",
        message: "Interval must be at least 1 second",
      });
    }

    if (!strategyConfigValid) {
      issues.push({
        nodeId: "general",
        message: "Strategy configuration is invalid",
      });
    }

    for (const [entryId, isValid] of Object.entries(collectorsValidity)) {
      if (!isValid) {
        const collector = formState.collectors.find((c) => c.id === entryId);
        const collectorDef = availableCollectors.find(
          (c) => c.id === collector?.collectorId,
        );
        issues.push({
          nodeId: `collector:${entryId}`,
          message: `${collectorDef?.displayName ?? "Collector"} config is invalid`,
        });
      }
    }

    return issues;
  }, [
    formState.name,
    formState.intervalSeconds,
    formState.collectors,
    strategyConfigValid,
    collectorsValidity,
    availableCollectors,
  ]);

  const isValid = validationIssues.length === 0;

  // --- Save ---

  const associateMutation = healthCheckClient.associateSystem.useMutation();

  const createMutation = healthCheckClient.createConfiguration.useMutation({
    onSuccess: async (created) => {
      setIsDirty(false);

      // Fan-out: assign the new config to each selected system.
      if (selectedSystemIds.length > 0 && created?.id) {
        const results = await Promise.allSettled(
          selectedSystemIds.map((systemId) =>
            associateMutation.mutateAsync({
              systemId,
              body: {
                configurationId: created.id,
                enabled: true,
                stateThresholds: DEFAULT_STATE_THRESHOLDS,
                includeLocal: true,
              },
            }),
          ),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          toast.error(
            `Health check created, but ${failed} of ${selectedSystemIds.length} system assignment${selectedSystemIds.length === 1 ? "" : "s"} failed.`,
          );
        } else {
          toast.success(
            `Health check created and assigned to ${selectedSystemIds.length} system${selectedSystemIds.length === 1 ? "" : "s"}`,
          );
        }
      } else {
        toast.success("Health check created");
      }

      // Where to land: prefer back to the originating system's assignment IDE
      // when the user came from there, otherwise the config list.
      if (
        systemIdFromUrl &&
        selectedSystemIds.includes(systemIdFromUrl)
      ) {
        navigate(
          resolveRoute(healthcheckRoutes.routes.assignments, {
            systemId: systemIdFromUrl,
          }),
        );
      } else {
        navigate(resolveRoute(healthcheckRoutes.routes.config));
      }
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to create"));
    },
  });

  const updateMutation = healthCheckClient.updateConfiguration.useMutation({
    onSuccess: () => {
      setIsDirty(false);
      toast.success("Health check updated");
      navigate(resolveRoute(healthcheckRoutes.routes.config));
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to update"));
    },
  });

  const handleSave = () => {
    if (!isValid || !activeStrategyId) return;

    const payload = {
      name: formState.name,
      strategyId: activeStrategyId,
      config: formState.strategyConfig,
      intervalSeconds: formState.intervalSeconds,
      collectors: formState.collectors,
    };

    if (isEditMode && configId) {
      updateMutation.mutate({ id: configId, body: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // --- Loading States ---

  if (isEditMode && configLoading) {
    return (
      <PageLayout
        title="Edit Health Check"
        icon={Settings}
        loading
      >
        <div />
      </PageLayout>
    );
  }

  if (isEditMode && !existingConfig && !configLoading) {
    return (
      <PageLayout
        title="Health Check Not Found"
        subtitle="The requested configuration could not be found."
        icon={Settings}
      >
        <div className="text-center py-12 text-muted-foreground">
          <p>This configuration may have been deleted.</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={isEditMode ? `Edit: ${formState.name || "Unnamed"}` : "New Health Check"}
      subtitle={activeStrategy?.displayName}
      icon={Settings}
      maxWidth="full"
      actions={
        <Button
          onClick={handleSave}
      disabled={!isValid || isSaving || isLocked}
        >
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? "Saving..." : "Save"}
        </Button>
      }
    >
      {isLocked && provenance && (
        <div className="mb-4">
          <GitOpsLockBanner provenance={provenance} />
        </div>
      )}
      <IDELayout
        tree={
          <EditorTree
            collectors={formState.collectors}
            availableCollectors={availableCollectors}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            onAddCollector={handleCollectorAdd}
            validationIssues={validationIssues}
            strategyId={activeStrategyId ?? ""}
            configId={configId}
            showSystemsNode={!isEditMode}
            selectedSystemCount={selectedSystemIds.length}
          />
        }
        panel={
          <>
            <EditorPanel
              selectedNode={selectedNode}
              formState={formState}
              strategy={activeStrategy}
              availableCollectors={availableCollectors}
              collectorsLoading={collectorsLoading}
              isEditMode={isEditMode}
              configId={configId}
              onNameChange={(name) => updateField("name", name)}
              onIntervalChange={(interval) =>
                updateField("intervalSeconds", interval)
              }
              onStrategyConfigChange={(config) =>
                updateField("strategyConfig", config)
              }
              onStrategyConfigValidChange={setStrategyConfigValid}
              onCollectorConfigChange={handleCollectorConfigChange}
              onCollectorAssertionsChange={handleCollectorAssertionsChange}
              onCollectorValidChange={handleCollectorValidChange}
              onCollectorRemove={handleCollectorRemove}
              onCollectorAdd={handleCollectorAdd}
              strategyId={activeStrategyId ?? ""}
              showSystemsSection={!isEditMode}
              systems={systems}
              systemsLoading={systemsLoading}
              selectedSystemIds={selectedSystemIds}
              onSystemsChange={(ids) => {
                setSelectedSystemIds(ids);
                setIsDirty(true);
              }}
            />
            {configId && (
              <ExtensionSlot
                slot={HealthCheckConfigIDEPanelSlot}
                context={{
                  configurationId: configId,
                  strategyId: activeStrategyId ?? "",
                  selectedNode,
                  onSelectNode: setSelectedNode,
                  isLocked,
                }}
              />
            )}
          </>
        }
        issues={validationIssues}
        onIssueClick={(nodeId) => setSelectedNode(nodeId as TreeNodeId)}
      />
    </PageLayout>
  );
};

export const HealthCheckIDEPage = wrapInSuspense(HealthCheckIDEPageContent);
