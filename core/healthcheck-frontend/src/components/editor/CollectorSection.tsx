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
  listSecretFieldKeys,
  type TemplateCompletionProvider,
  type OptionsResolver,
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
import { AssertionBuilder } from "../AssertionBuilder";
import { createCollectorScriptTestRenderer } from "./CollectorScriptTestRenderer";
import { schemaHasTemplatableFields } from "./collector-preview-context.logic";

interface CollectorSectionProps {
  entry: CollectorConfigEntry;
  collectorDef: CollectorDto | undefined;
  /**
   * EDIT mode: the loaded config is REDACTED (x-secret fields absent), so a
   * blank secret input means "keep the stored value" and must count as
   * valid. CREATE mode leaves blank secrets genuinely required.
   */
  isEditMode: boolean;
  /**
   * EDIT mode: this collector entry's secret field keys that ACTUALLY have a
   * stored value (`configuredSecrets.collectors[entry.id]`). Drives
   * keep-existing validation and the stored-secret hint / Clear so a never-set
   * optional secret does not falsely claim one is stored. Falls back to every
   * schema secret key when the signal is absent (older backend).
   */
  storedSecretKeys?: string[];
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
  /**
   * `{{ … }}` autocomplete provider seeded with the fixed
   * `environment.* / check.* / system.*` namespace. Wired to templatable
   * collector fields only.
   */
  templateCompletionProvider?: TemplateCompletionProvider;
  /**
   * Resolvers for this collector config's `x-options-resolver` dropdown fields,
   * contributed by the plugin owning the strategy (e.g. a log-stream pattern
   * picker). Built with the STRATEGY config as context, so a collector-field
   * resolver can read a selection made in the sibling strategy form.
   */
  optionsResolvers?: Record<string, OptionsResolver>;
}

export const CollectorSection: React.FC<CollectorSectionProps> = ({
  entry,
  collectorDef,
  isEditMode,
  storedSecretKeys,
  onConfigChange,
  onAssertionsChange,
  onValidChange,
  onRemove,
  previewEnvironments,
  previewEnvironmentId,
  onPreviewEnvironmentChange,
  templatePreviewContext,
  templateCompletionProvider,
  optionsResolvers,
}) => {
  const scriptTestRenderer = React.useMemo(
    () => createCollectorScriptTestRenderer(entry.config),
    [entry.config],
  );
  // The section's validity is the AND of the config form and the assertion
  // rows - an incomplete assertion blocks Save exactly like an invalid
  // config field. Held locally so either source can change independently.
  const [configValid, setConfigValid] = React.useState(true);
  const [assertionsValid, setAssertionsValid] = React.useState(true);
  const sectionValid = configValid && assertionsValid;
  // Report through a ref'd callback: the parent recreates `onValidChange`
  // every render, and depending on it directly would re-fire (and loop via
  // the parent's setState) even when validity did not change.
  const onValidChangeRef = React.useRef(onValidChange);
  onValidChangeRef.current = onValidChange;
  React.useEffect(() => {
    onValidChangeRef.current(sectionValid);
  }, [sectionValid]);
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
                onValidChange={setConfigValid}
                templatePreviewContext={templatePreviewContext}
                optionsResolvers={optionsResolvers}
                {...ctx}
                // After `ctx`: the fixed `environment.*/check.*/system.*`
                // completion is wired ONLY to `x-templatable` collector fields
                // (e.g. the HTTP url), leaving script fields to `ctx`.
                templateCompletionProvider={templateCompletionProvider}
                templatableFieldsOnly
                scriptTestRenderer={scriptTestRenderer}
                secretNames={secretNames}
                keepExistingSecretFields={
                  isEditMode
                    ? (storedSecretKeys ??
                      listSecretFieldKeys(collectorDef.configSchema))
                    : []
                }
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
              All conditions must pass for this check item to be healthy.
            </p>
          </div>
          <AssertionBuilder
            resultSchema={collectorDef.resultSchema}
            assertions={entry.assertions ?? []}
            onChange={onAssertionsChange}
            onValidChange={setAssertionsValid}
          />
        </div>
      )}
    </div>
  );
};
