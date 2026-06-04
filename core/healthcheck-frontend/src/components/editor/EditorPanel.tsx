import React from "react";
import type {
  CollectorConfigEntry,
  CollectorDto,
  HealthCheckStrategyDto,
} from "@checkstack/healthcheck-common";
import type { TreeNodeId } from "./EditorTree";
import { GeneralSection } from "./GeneralSection";
import { CollectorSection } from "./CollectorSection";
import { CollectorPicker } from "./CollectorPicker";
import { SystemsSection } from "./SystemsSection";
import { TeamAccessEditor } from "@checkstack/auth-frontend";
import type { Environment } from "@checkstack/catalog-frontend";

// =============================================================================
// TYPES
// =============================================================================

interface EditorPanelProps {
  selectedNode: TreeNodeId;
  formState: {
    name: string;
    intervalSeconds: number;
    strategyConfig: Record<string, unknown>;
    collectors: CollectorConfigEntry[];
  };
  strategy: HealthCheckStrategyDto | undefined;
  availableCollectors: CollectorDto[];
  collectorsLoading: boolean;
  isEditMode: boolean;
  configId: string | undefined;
  onNameChange: (name: string) => void;
  onIntervalChange: (interval: number) => void;
  onStrategyConfigChange: (config: Record<string, unknown>) => void;
  onStrategyConfigValidChange: (isValid: boolean) => void;
  onCollectorConfigChange: (
    entryId: string,
    config: Record<string, unknown>,
  ) => void;
  onCollectorAssertionsChange: (
    entryId: string,
    assertions: CollectorConfigEntry["assertions"],
  ) => void;
  onCollectorValidChange: (entryId: string, isValid: boolean) => void;
  onCollectorRemove: (entryId: string) => void;
  onCollectorAdd: (collectorId: string) => void;
  strategyId: string;
  showSystemsSection?: boolean;
  systems?: Array<{ id: string; name: string; description?: string | null }>;
  systemsLoading?: boolean;
  selectedSystemIds?: string[];
  onSystemsChange?: (systemIds: string[]) => void;
  /**
   * Environments offered in the collector "Preview as" picker (the system's
   * environments when a single system is in context, else all). Empty hides
   * the picker.
   */
  previewEnvironments?: ReadonlyArray<Environment>;
  /** Selected preview environment id (shared across collectors). */
  previewEnvironmentId?: string | null;
  /** Called when the author picks (or clears) a preview environment. */
  onPreviewEnvironmentChange?: (environmentId: string | null) => void;
  /**
   * Sample context for previewing the selected collector's `x-templatable`
   * fields, built from the chosen environment. `undefined` when none chosen.
   */
  templatePreviewContext?: Record<string, unknown>;
}

// =============================================================================
// PANEL COMPONENT
// =============================================================================

export const EditorPanel: React.FC<EditorPanelProps> = ({
  selectedNode,
  formState,
  strategy,
  availableCollectors,
  collectorsLoading,
  isEditMode,
  configId,
  onNameChange,
  onIntervalChange,
  onStrategyConfigChange,
  onStrategyConfigValidChange,
  onCollectorConfigChange,
  onCollectorAssertionsChange,
  onCollectorValidChange,
  onCollectorRemove,
  onCollectorAdd,
  strategyId,
  showSystemsSection = false,
  systems = [],
  systemsLoading = false,
  selectedSystemIds = [],
  onSystemsChange,
  previewEnvironments = [],
  previewEnvironmentId = null,
  onPreviewEnvironmentChange,
  templatePreviewContext,
}) => {
  // --- General Section ---
  if (selectedNode === "general") {
    return (
      <div className="p-6">
        <GeneralSection
          name={formState.name}
          intervalSeconds={formState.intervalSeconds}
          strategyConfig={formState.strategyConfig}
          strategy={strategy}
          onNameChange={onNameChange}
          onIntervalChange={onIntervalChange}
          onStrategyConfigChange={onStrategyConfigChange}
          onStrategyConfigValidChange={onStrategyConfigValidChange}
        />
      </div>
    );
  }

  // --- Collector Picker ---
  if (selectedNode === "collector-picker") {
    return (
      <div className="p-6">
        <CollectorPicker
          availableCollectors={availableCollectors}
          configuredCollectors={formState.collectors}
          loading={collectorsLoading}
          onAdd={onCollectorAdd}
          strategyId={strategyId}
        />
      </div>
    );
  }

  // --- Systems Section ---
  if (selectedNode === "systems" && showSystemsSection) {
    return (
      <div className="p-6">
        <SystemsSection
          systems={systems}
          selectedSystemIds={selectedSystemIds}
          loading={systemsLoading}
          onChange={(ids) => onSystemsChange?.(ids)}
        />
      </div>
    );
  }

  // --- Access Control ---
  if (selectedNode === "access") {
    return (
      <div className="p-6">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Access Control</h2>
            <p className="text-sm text-muted-foreground">
              Manage team permissions for this health check configuration.
            </p>
          </div>
          {isEditMode && configId ? (
            <TeamAccessEditor
              resourceType="healthcheck.configuration"
              resourceId={configId}
              compact
              expanded
            />
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Access control is available after saving the configuration.
            </p>
          )}
        </div>
      </div>
    );
  }

  // --- Collector Section ---
  if (selectedNode.startsWith("collector:")) {
    const entryId = selectedNode.replace("collector:", "");
    const entry = formState.collectors.find((c) => c.id === entryId);

    if (!entry) {
      return (
        <div className="p-6 text-muted-foreground">Collector not found.</div>
      );
    }

    const collectorDef = availableCollectors.find(
      (c) => c.id === entry.collectorId,
    );

    return (
      <div className="p-6">
        <CollectorSection
          entry={entry}
          collectorDef={collectorDef}
          onConfigChange={(config) => onCollectorConfigChange(entryId, config)}
          onAssertionsChange={(assertions) =>
            onCollectorAssertionsChange(entryId, assertions)
          }
          onValidChange={(isValid) => onCollectorValidChange(entryId, isValid)}
          onRemove={() => onCollectorRemove(entryId)}
          previewEnvironments={previewEnvironments}
          previewEnvironmentId={previewEnvironmentId}
          onPreviewEnvironmentChange={(id) =>
            onPreviewEnvironmentChange?.(id)
          }
          templatePreviewContext={templatePreviewContext}
        />
      </div>
    );
  }

  return;
};
