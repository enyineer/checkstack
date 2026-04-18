import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  usePluginClient,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";
import {
  healthcheckRoutes,
  type CollectorConfigEntry,
} from "@checkstack/healthcheck-common";
import { PageLayout, Button, useToast } from "@checkstack/ui";
import { Save, Settings } from "lucide-react";
import { resolveRoute } from "@checkstack/common";
import { useCollectors } from "../hooks/useCollectors";
import { EditorTree, type TreeNodeId } from "../components/editor/EditorTree";
import { EditorPanel } from "../components/editor/EditorPanel";
import { IDEStatusBar, type ValidationIssue } from "../components/editor/IDEStatusBar";

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

  // "new" is a sentinel value used by the create flow
  const isEditMode = !!configId && configId !== "new";
  const strategyIdFromUrl = searchParams.get("strategy") ?? undefined;

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

  const createMutation = healthCheckClient.createConfiguration.useMutation({
    onSuccess: () => {
      setIsDirty(false);
      toast.success("Health check created");
      navigate(resolveRoute(healthcheckRoutes.routes.config));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create");
    },
  });

  const updateMutation = healthCheckClient.updateConfiguration.useMutation({
    onSuccess: () => {
      setIsDirty(false);
      toast.success("Health check updated");
      navigate(resolveRoute(healthcheckRoutes.routes.config));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update");
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
          disabled={!isValid || isSaving}
        >
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? "Saving..." : "Save"}
        </Button>
      }
    >
      <div className="flex flex-col lg:flex-row gap-0 min-h-[60vh] border rounded-lg bg-card overflow-hidden">
        {/* Explorer Tree — Left Panel */}
        <div className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r bg-muted/30">
          <EditorTree
            collectors={formState.collectors}
            availableCollectors={availableCollectors}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            onAddCollector={handleCollectorAdd}
            validationIssues={validationIssues}
            strategyId={activeStrategyId ?? ""}
          />
        </div>

        {/* Editor Panel — Right Panel */}
        <div className="flex-1 min-w-0">
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
          />
        </div>
      </div>

      {/* Status Bar */}
      <IDEStatusBar
        issues={validationIssues}
        onIssueClick={(nodeId) => setSelectedNode(nodeId)}
      />
    </PageLayout>
  );
};

export const HealthCheckIDEPage = wrapInSuspense(HealthCheckIDEPageContent);
