import React from "react";
import type {
  CollectorConfigEntry,
  CollectorDto,
  HealthCheckStrategyDto,
} from "@checkstack/healthcheck-common";
import {
  healthCheckAccess,
  healthCheckResourceTypes,
} from "@checkstack/healthcheck-common";
import type { TreeNodeId } from "./EditorTree";
import { GeneralSection } from "./GeneralSection";
import { CollectorSection } from "./CollectorSection";
import { CollectorPicker } from "./CollectorPicker";
import { SystemsSection } from "./SystemsSection";
import { TeamAccessEditor, TeamOwnershipPicker } from "@checkstack/auth-frontend";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import type { Environment } from "@checkstack/catalog-frontend";
import type { TemplateCompletionProvider } from "@checkstack/ui";
import { useConfigOptionsResolvers } from "./options-resolvers";

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
  /**
   * EDIT mode: which secret fields ACTUALLY have a stored value
   * (`configuredSecrets` from the redacted read), so the editor shows the
   * stored-secret hint / Clear only where one exists. `strategy` lists the
   * strategy's populated secret keys; `collectors` maps a collector entry id to
   * its populated keys.
   */
  configuredSecrets?: {
    strategy: string[];
    collectors: Record<string, string[]>;
  };
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
  /**
   * `{{ … }}` autocomplete provider seeded with the fixed
   * `environment.* / check.* / system.*` namespace, shared by the strategy and
   * collector config forms. Wired to `x-templatable` fields only.
   */
  templateCompletionProvider?: TemplateCompletionProvider;
  /**
   * Owning-team selection for create mode. `null` means global (no team).
   * Only used when `!isEditMode` — ignored in edit mode.
   */
  ownerTeamId?: string | null;
  onOwnerTeamIdChange?: (teamId: string | null) => void;
  /** Inline error to display on the TeamOwnershipPicker (create mode only). */
  ownerTeamError?: string | null;
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
  configuredSecrets,
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
  templateCompletionProvider,
  ownerTeamId = null,
  onOwnerTeamIdChange,
  ownerTeamError = null,
}) => {
  const accessApi = useApi(accessApiRef);
  const { allowed: allowGlobal } = accessApi.useAccess(
    healthCheckAccess.configuration.manage,
  );
  // Dropdown resolvers for `x-options-resolver` config fields, contributed by
  // the plugin that owns this strategy (e.g. the log-stream stream/pattern
  // pickers). Stable object; shared by the strategy and collector config forms.
  // The collector forms get the SAME strategy config so a collector-field
  // resolver can read a selection made in the strategy form.
  const configOptionsResolvers = useConfigOptionsResolvers({
    strategyId,
    strategyConfig: formState.strategyConfig,
  });
  // --- General Section ---
  if (selectedNode === "general") {
    return (
      <div className="p-6">
        <GeneralSection
          name={formState.name}
          isEditMode={isEditMode}
          storedSecretKeys={configuredSecrets?.strategy}
          intervalSeconds={formState.intervalSeconds}
          strategyConfig={formState.strategyConfig}
          strategy={strategy}
          previewEnvironments={previewEnvironments}
          previewEnvironmentId={previewEnvironmentId}
          onPreviewEnvironmentChange={(id) =>
            onPreviewEnvironmentChange?.(id)
          }
          templatePreviewContext={templatePreviewContext}
          templateCompletionProvider={templateCompletionProvider}
          optionsResolvers={configOptionsResolvers}
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
              resourceType={healthCheckResourceTypes.configuration}
              resourceId={configId}
              compact
              expanded
            />
          ) : (
            <div className="space-y-4">
              <TeamOwnershipPicker
                value={ownerTeamId}
                onChange={(teamId) => onOwnerTeamIdChange?.(teamId)}
                allowGlobal={allowGlobal}
                error={ownerTeamError}
              />
              <p className="text-sm text-muted-foreground italic">
                Fine-grained team access control is available after saving the
                configuration.
              </p>
            </div>
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
          isEditMode={isEditMode}
          // A signal that is PRESENT but lacks this entry means a collector
          // added mid-edit (its fresh id is not in the stored map) -> nothing
          // stored, so `[]` (blank required secrets stay required, no false
          // "stored" hint). Only a wholly ABSENT signal (older backend) falls
          // back to marking every schema secret keep-existing.
          storedSecretKeys={
            configuredSecrets
              ? (configuredSecrets.collectors[entry.id] ?? [])
              : undefined
          }
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
          templateCompletionProvider={templateCompletionProvider}
          optionsResolvers={configOptionsResolvers}
        />
      </div>
    );
  }

  return;
};
