import { useCallback, useMemo } from "react";
import {
  ExtensionComponent,
  useApi,
  useSlotExtensions,
  accessApiRef,
} from "@checkstack/frontend-api";
import { DynamicForm, Input, Label, Textarea } from "@checkstack/ui";
import { satelliteAccess } from "@checkstack/satellite-common";
import {
  SourceConfigSlot,
  type SourceTypeDescriptor,
} from "@checkstack/telemetry-common";
import {
  MAX_SOURCE_NAME_CHARS,
  MAX_SOURCE_DESCRIPTION_CHARS,
} from "@checkstack/telemetry-common";
import {
  asConfigSchema,
  isPullType,
  supportsSatellitePicker,
  type SourceEditorValues,
} from "../lib/source-form.logic";
import { selectConfigFiller } from "../lib/source-config-slot.logic";
import { TestConnectionButton } from "./TestConnectionButton";
import { RunFromSatelliteSelect } from "./RunFromSatelliteSelect";

export interface SourceConfigFieldsProps {
  descriptor: SourceTypeDescriptor;
  values: SourceEditorValues;
  onChange: (patch: Partial<SourceEditorValues>) => void;
  /** Secret keys with stored values (EDIT mode) for keep-existing semantics. */
  keepExistingSecretFields?: string[];
  /** Existing source id, so "Test connection" can reuse stored secrets. */
  sourceId?: string;
  disabled?: boolean;
}

/**
 * The name/description/config/interval fields shared by the create and edit
 * dialogs. The config section is schema-driven (DynamicForm from the type's
 * serialized `configSchema`) unless a `SourceConfigSlot` filler renders a
 * bespoke editor for this `sourceTypeId`, in which case it replaces the form.
 */
export function SourceConfigFields({
  descriptor,
  values,
  onChange,
  keepExistingSecretFields,
  sourceId,
  disabled,
}: SourceConfigFieldsProps) {
  const pull = isPullType(descriptor);
  const accessApi = useApi(accessApiRef);

  // The "Run from" picker calls the satellite API, which needs satellite read
  // access. Hide it for a source manager who lacks that access; the form still
  // seeds `satelliteId` from the instance, so an existing binding is preserved
  // on save even when the picker is not shown (mirrors ScrapeTargetDialog).
  const { allowed: canReadSatellites } = accessApi.useAccess(
    satelliteAccess.satellite.read,
  );
  const showSatellitePicker =
    supportsSatellitePicker(descriptor) && canReadSatellites;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="source-name">Name</Label>
        <Input
          id="source-name"
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="prod-us-east"
          autoFocus
          maxLength={MAX_SOURCE_NAME_CHARS}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="source-description">Description</Label>
        <Textarea
          id="source-description"
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="What this source ingests and where it comes from"
          rows={2}
          maxLength={MAX_SOURCE_DESCRIPTION_CHARS}
          disabled={disabled}
        />
      </div>

      <ConfigSection
        descriptor={descriptor}
        config={values.config}
        onConfigChange={(config) => onChange({ config })}
        keepExistingSecretFields={keepExistingSecretFields}
        disabled={disabled}
      />

      {pull && (
        <div className="space-y-1.5">
          <Label htmlFor="source-interval">Poll interval (seconds)</Label>
          <Input
            id="source-interval"
            type="number"
            min={descriptor.pull?.minIntervalSeconds}
            value={values.intervalSeconds ?? ""}
            onChange={(e) =>
              onChange({
                intervalSeconds:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
            disabled={disabled}
          />
          {descriptor.pull && (
            <p className="text-xs text-muted-foreground">
              Minimum {descriptor.pull.minIntervalSeconds}s. Defaults to{" "}
              {descriptor.pull.defaultIntervalSeconds}s.
            </p>
          )}
        </div>
      )}

      {showSatellitePicker && (
        <RunFromSatelliteSelect
          value={values.satelliteId}
          onChange={(satelliteId) => onChange({ satelliteId })}
          disabled={disabled}
        />
      )}

      {pull && (
        <TestConnectionButton
          sourceTypeId={descriptor.id}
          config={values.config}
          sourceId={sourceId}
          disabled={disabled}
        />
      )}
    </div>
  );
}

/**
 * Config editor: renders the `SourceConfigSlot` filler whose
 * `metadata.sourceTypeId` matches this type, or falls back to a schema-driven
 * DynamicForm when none matches. The host filters fillers by metadata (see
 * `selectConfigFiller`), so unrelated fillers are never mounted and the
 * generic form shows only for types without a bespoke editor.
 */
function ConfigSection({
  descriptor,
  config,
  onConfigChange,
  keepExistingSecretFields,
  disabled,
}: {
  descriptor: SourceTypeDescriptor;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
  keepExistingSecretFields?: string[];
  disabled?: boolean;
}) {
  const extensions = useSlotExtensions(SourceConfigSlot);

  // Stable callback so the memoized slot context bails out on unchanged values
  // (see `.claude/rules/performance.md`). `config` legitimately changes per
  // keystroke; `sourceTypeId`/`disabled` are primitives.
  const handleConfigChange = useCallback(
    (next: Record<string, unknown>) => onConfigChange(next),
    [onConfigChange],
  );

  const slotContext = useMemo(
    () => ({
      sourceTypeId: descriptor.id,
      config,
      onConfigChange: handleConfigChange,
      disabled,
    }),
    [descriptor.id, config, handleConfigChange, disabled],
  );

  const schema = useMemo(
    () => asConfigSchema(descriptor.configSchema),
    [descriptor.configSchema],
  );

  const filler = selectConfigFiller({
    extensions,
    sourceTypeId: descriptor.id,
  });

  if (filler) {
    return <ExtensionComponent extension={filler} context={slotContext} />;
  }

  return (
    <DynamicForm
      schema={schema}
      value={config}
      onChange={handleConfigChange}
      keepExistingSecretFields={keepExistingSecretFields}
      showInlineErrors
    />
  );
}
