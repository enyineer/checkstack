import React from "react";
import type { HealthCheckStrategyDto } from "@checkstack/healthcheck-common";
import {
  Input,
  Label,
  DynamicForm,
  MarkdownBlock,
  listSecretFieldKeys,
  type TemplateCompletionProvider,
  type OptionsResolver,
} from "@checkstack/ui";
import {
  EnvironmentPreviewPicker,
  SystemPreviewPicker,
  type PreviewSystem,
  type Environment,
} from "@checkstack/catalog-frontend";
import { AlertTriangle, BookOpen } from "lucide-react";
import { schemaHasTemplatableFields } from "./collector-preview-context.logic";

interface GeneralSectionProps {
  name: string;
  intervalSeconds: number;
  strategyConfig: Record<string, unknown>;
  strategy: HealthCheckStrategyDto | undefined;
  /**
   * Environments offered in the strategy "Preview as" picker (the system's when
   * one is in context, else all). Empty hides the picker.
   */
  previewEnvironments?: ReadonlyArray<Environment>;
  /** Selected preview environment id (shared with the collector forms). */
  previewEnvironmentId?: string | null;
  /** Systems offered in the preview picker (see CollectorSection). */
  previewSystems?: ReadonlyArray<PreviewSystem>;
  /** Currently selected preview system id. */
  previewSystemId?: string | null;
  /** Called when the author picks (or clears) a preview system. */
  onPreviewSystemChange?: (systemId: string | null) => void;
  /** Called when the author picks (or clears) a preview environment. */
  onPreviewEnvironmentChange?: (environmentId: string | null) => void;
  /**
   * Sample `{ environment, check, system }` context for previewing the
   * strategy's `x-templatable` connection fields (host, servername, …).
   * `undefined` when no environment is selected (preview line stays hidden).
   */
  templatePreviewContext?: Record<string, unknown>;
  /**
   * `{{ … }}` autocomplete provider seeded with the fixed
   * `environment.* / check.* / system.*` namespace. Wired to templatable
   * connection fields only.
   */
  templateCompletionProvider?: TemplateCompletionProvider;
  /**
   * Resolvers for the strategy config's `x-options-resolver` dropdown fields,
   * contributed by the plugin owning this strategy (e.g. a log-stream picker).
   * A stable object; omit for strategies with no dynamic-option fields.
   */
  optionsResolvers?: Record<string, OptionsResolver>;
  /**
   * EDIT mode: the loaded config is REDACTED (x-secret fields absent), so a
   * blank secret input means "keep the stored value" and must count as
   * valid. CREATE mode leaves blank secrets genuinely required.
   */
  isEditMode: boolean;
  /**
   * EDIT mode: the strategy secret field keys that ACTUALLY have a stored value
   * (`configuredSecrets.strategy` from the redacted read). Drives the
   * keep-existing validation and the "a secret is stored" / Clear affordance so
   * a never-set optional secret does not falsely claim one is stored. Falls
   * back to every schema secret key when the signal is absent (older backend).
   */
  storedSecretKeys?: string[];
  onNameChange: (name: string) => void;
  onIntervalChange: (interval: number) => void;
  onStrategyConfigChange: (config: Record<string, unknown>) => void;
  onStrategyConfigValidChange: (isValid: boolean) => void;
}

export const GeneralSection: React.FC<GeneralSectionProps> = ({
  name,
  intervalSeconds,
  strategyConfig,
  strategy,
  isEditMode,
  storedSecretKeys,
  previewEnvironments = [],
  previewEnvironmentId = null,
  previewSystems = [],
  previewSystemId = null,
  onPreviewSystemChange,
  onPreviewEnvironmentChange,
  templatePreviewContext,
  templateCompletionProvider,
  optionsResolvers,
  onNameChange,
  onIntervalChange,
  onStrategyConfigChange,
  onStrategyConfigValidChange,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">General</h2>
        <p className="text-sm text-muted-foreground">
          Basic configuration for this health check.
        </p>
      </div>

      {/* Strategy Display */}
      {strategy && (
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-surface-inset px-3 py-2">
          <span className="text-sm font-medium">{strategy.displayName}</span>
          {strategy.description && (
            <span className="text-xs text-muted-foreground">
              - {strategy.description}
            </span>
          )}
        </div>
      )}

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="hc-name">Name</Label>
        <Input
          id="hc-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Production API Health"
        />
      </div>

      {/* Interval */}
      <div className="space-y-2">
        <Label htmlFor="hc-interval">Interval (seconds)</Label>
        <Input
          id="hc-interval"
          type="number"
          min={1}
          value={intervalSeconds}
          onChange={(e) => onIntervalChange(Number(e.target.value))}
        />
        {intervalSeconds > 0 && intervalSeconds < 60 && (
          <div className="flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="h-3 w-3" />
            <span>
              Sub-minute intervals may cause high load on monitored services.
            </span>
          </div>
        )}
      </div>

      {/* Setup guide (only strategies that need host-side setup provide this) */}
      {strategy?.setupInstructions && (
        <details className="rounded-md border border-border/60 bg-surface-inset">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-sm font-medium marker:content-['']">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            Setup guide
            <span className="ml-auto text-xs text-muted-foreground">
              Read before you start
            </span>
          </summary>
          <div className="border-t border-border/60 px-3 py-2 text-sm">
            {/* Block, not inline: a setup guide is long-form prose with
                headings, numbered steps, and code blocks, all of which the
                inline renderer flattens into one run of text. */}
            <MarkdownBlock size="sm">{strategy.setupInstructions}</MarkdownBlock>
          </div>
        </details>
      )}

      {/* Strategy Config */}
      {strategy?.configSchema && (
        <div className="space-y-3 pt-2 border-t">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">Strategy Configuration</h3>
              <p className="text-xs text-muted-foreground">
                Settings specific to {strategy.displayName}.
              </p>
            </div>
            {/* Offer the environment preview only when a connection field is
                templatable, so host/port previews resolve against a sample
                environment exactly as the collector forms do. */}
            {schemaHasTemplatableFields(strategy.configSchema) && (
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                <EnvironmentPreviewPicker
                  environments={previewEnvironments}
                  selectedId={previewEnvironmentId}
                  onSelect={(id) => onPreviewEnvironmentChange?.(id)}
                />
                <SystemPreviewPicker
                  systems={previewSystems}
                  selectedId={previewSystemId}
                  onSelect={(id) => onPreviewSystemChange?.(id)}
                />
              </div>
            )}
          </div>
          <DynamicForm
            schema={strategy.configSchema}
            value={strategyConfig}
            onChange={onStrategyConfigChange}
            onValidChange={onStrategyConfigValidChange}
            templatePreviewContext={templatePreviewContext}
            templateCompletionProvider={templateCompletionProvider}
            optionsResolvers={optionsResolvers}
            templatableFieldsOnly
            keepExistingSecretFields={
              isEditMode
                ? (storedSecretKeys ??
                  listSecretFieldKeys(strategy.configSchema))
                : []
            }
          />
        </div>
      )}
    </div>
  );
};
