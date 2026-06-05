import React from "react";
import type {
  CollectorConfigEntry,
  CollectorDto,
} from "@checkstack/healthcheck-common";
import {
  Button,
  DynamicForm,
  Label,
  healthcheckScriptContext,
} from "@checkstack/ui";
import { Trash2 } from "lucide-react";
import {
  useScriptPackageTypeAcquisition,
  useSdkTypeInjection,
} from "@checkstack/script-packages-frontend";
import { useSecretNames } from "@checkstack/secrets-frontend";
import {
  EnvironmentPreviewPicker,
  type Environment,
} from "@checkstack/catalog-frontend";
import { AssertionBuilder, type Assertion } from "../AssertionBuilder";
import { createCollectorScriptTestRenderer } from "./CollectorScriptTestRenderer";
import { schemaHasTemplatableFields } from "./collector-preview-context.logic";

interface CollectorSectionProps {
  entry: CollectorConfigEntry;
  collectorDef: CollectorDto | undefined;
  onConfigChange: (config: Record<string, unknown>) => void;
  onAssertionsChange: (assertions: CollectorConfigEntry["assertions"]) => void;
  onValidChange: (isValid: boolean) => void;
  onRemove: () => void;
  /**
   * Environments offered in the "Preview as" picker (the system's when one is
   * in context, else all). Empty disables the picker.
   */
  previewEnvironments: ReadonlyArray<Environment>;
  /** Currently selected preview environment id (shared across collectors). */
  previewEnvironmentId: string | null;
  /** Called when the author picks (or clears) a preview environment. */
  onPreviewEnvironmentChange: (environmentId: string | null) => void;
  /**
   * Sample context for previewing `x-templatable` fields, built from the
   * selected environment's custom fields plus curated check/system metadata.
   * `undefined` when no environment is selected (preview line stays hidden).
   */
  templatePreviewContext?: Record<string, unknown>;
}

export const CollectorSection: React.FC<CollectorSectionProps> = ({
  entry,
  collectorDef,
  onConfigChange,
  onAssertionsChange,
  onValidChange,
  onRemove,
  previewEnvironments,
  previewEnvironmentId,
  onPreviewEnvironmentChange,
  templatePreviewContext,
}) => {
  const scriptTestRenderer = React.useMemo(
    () => createCollectorScriptTestRenderer(entry.config),
    [entry.config],
  );
  // Lazy ATA: collector scripts get package IntelliSense (incl. `@types/*`)
  // on demand for whatever npm packages they import. `importablePackages`
  // drives import-specifier name completion before any module is registered.
  const { acquireTypes, acquireResetKey, importablePackages } =
    useScriptPackageTypeAcquisition();
  // SDK editor types so `@checkstack/sdk/healthcheck` imports resolve.
  const { sdkTypes, sdkTypesResetKey } = useSdkTypeInjection();
  // Secret names (never values) for the secret -> env mapping editor.
  const { secretNames } = useSecretNames();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {collectorDef?.displayName ?? entry.collectorId}
          </h2>
          {collectorDef?.description && (
            <p className="text-sm text-muted-foreground">
              {collectorDef.description}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive shrink-0"
          onClick={onRemove}
          title="Remove collector"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Configuration */}
      {collectorDef?.configSchema && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-sm font-semibold">Configuration</Label>
              <p className="text-xs text-muted-foreground">
                Configure how this check item behaves.
              </p>
            </div>
            {/* Only offer the preview picker when a templatable field exists. */}
            {schemaHasTemplatableFields(collectorDef.configSchema) && (
              <EnvironmentPreviewPicker
                environments={previewEnvironments}
                selectedId={previewEnvironmentId}
                onSelect={onPreviewEnvironmentChange}
              />
            )}
          </div>
          {(() => {
            const ctx = healthcheckScriptContext({
              collectorConfigSchema: collectorDef.configSchema,
              // Surface the user's own `env` keys as `$`-completions.
              customEnv: entry.config.env,
            });
            return (
              <DynamicForm
                schema={collectorDef.configSchema}
                value={entry.config}
                onChange={onConfigChange}
                onValidChange={onValidChange}
                templatePreviewContext={templatePreviewContext}
                {...ctx}
                scriptTestRenderer={scriptTestRenderer}
                secretNames={secretNames}
                acquireTypes={acquireTypes}
                acquireResetKey={acquireResetKey}
                sdkTypes={sdkTypes}
                sdkTypesResetKey={sdkTypesResetKey}
                importablePackages={importablePackages}
              />
            );
          })()}
        </div>
      )}

      {/* Assertions */}
      {collectorDef?.resultSchema && (
        <div className="space-y-3 pt-2 border-t">
          <div>
            <Label className="text-sm font-semibold">Assertions</Label>
            <p className="text-xs text-muted-foreground">
              Define conditions that must be met for this check to pass.
            </p>
          </div>
          <AssertionBuilder
            resultSchema={collectorDef.resultSchema}
            assertions={
              (entry.assertions as unknown as Assertion[]) ?? []
            }
            onChange={(assertions) =>
              onAssertionsChange(
                assertions as unknown as CollectorConfigEntry["assertions"],
              )
            }
          />
        </div>
      )}
    </div>
  );
};
