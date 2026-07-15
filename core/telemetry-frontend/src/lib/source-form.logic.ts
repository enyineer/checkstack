import type { JsonSchema } from "@checkstack/ui";
import { omitKeepExistingSecrets } from "@checkstack/ui";
import type {
  CreateTelemetrySource,
  SourceTypeDescriptor,
  TelemetrySource,
  UpdateTelemetrySource,
} from "@checkstack/telemetry-common";
import {
  bindingsToArray,
  type BindingSelection,
} from "./binding-editor.logic";

/**
 * A descriptor's `configSchema` arrives over the wire as a plain object
 * (`Record<string, unknown>`), but DynamicForm consumes the structural
 * `JsonSchema` type. The backend produces it with `toJsonSchema`, so the shape
 * is guaranteed; bridge the boundary the same way anomaly-frontend and the
 * integration editor bridge their serialized schemas.
 */
export function asConfigSchema(
  configSchema: Record<string, unknown>,
): JsonSchema {
  return configSchema as JsonSchema;
}

export function isPullType(descriptor: SourceTypeDescriptor): boolean {
  return descriptor.modes.includes("pull");
}

export function isWebhookType(descriptor: SourceTypeDescriptor): boolean {
  return descriptor.modes.includes("webhook");
}

export function isPushType(descriptor: SourceTypeDescriptor): boolean {
  return descriptor.modes.includes("push");
}

/**
 * Whether the config step should render NO schema form: a push-mode type whose
 * config schema has no properties (the platform Sources section is its only
 * ingest surface, so it carries name/description/binding but no config fields).
 * Such a type shows its push endpoints/snippets in place of an empty form.
 */
export function hasEmptyConfigSchema(
  descriptor: SourceTypeDescriptor,
): boolean {
  const schema = descriptor.configSchema;
  const properties = schema.properties;
  if (properties === undefined || properties === null) return true;
  if (typeof properties !== "object") return true;
  return Object.keys(properties).length === 0;
}

/**
 * The interval an editor should seed for a pull-capable type: the instance's
 * own override when set, else the type's default. `null` for non-pull types
 * (the field is hidden and ignored server-side).
 */
export function deriveInitialInterval({
  descriptor,
  source,
}: {
  descriptor: SourceTypeDescriptor;
  source?: TelemetrySource | null;
}): number | null {
  if (!isPullType(descriptor) || !descriptor.pull) return null;
  if (source && source.intervalSeconds !== null) return source.intervalSeconds;
  return descriptor.pull.defaultIntervalSeconds;
}

/** Clamp a chosen interval up to the type's minimum (mirrors the server clamp). */
export function clampInterval({
  value,
  descriptor,
}: {
  value: number;
  descriptor: SourceTypeDescriptor;
}): number {
  const min = descriptor.pull?.minIntervalSeconds ?? 1;
  return Math.max(min, Math.trunc(value));
}

/**
 * The interval to SEND for a pull-capable type. When the field is cleared
 * (`null`) the caller decides the wire value: create omits it (`whenNull:
 * undefined`) so the type default applies; update sends `null` to clear an
 * override. Non-pull types always resolve to `undefined` (the field is ignored).
 */
function resolveInterval<TNull extends null | undefined>({
  descriptor,
  intervalSeconds,
  whenNull,
}: {
  descriptor: SourceTypeDescriptor;
  intervalSeconds: number | null;
  whenNull: TNull;
}): number | TNull | undefined {
  if (!isPullType(descriptor)) return undefined;
  if (intervalSeconds === null) return whenNull;
  return clampInterval({ value: intervalSeconds, descriptor });
}

/**
 * The mutable editor state shared by the create and edit dialogs. `config` is
 * whatever DynamicForm (or a source-config slot) currently holds; secret values
 * a stored instance reads back OMITTED, so a blank secret input means "keep".
 */
export interface SourceEditorValues {
  name: string;
  description: string;
  config: Record<string, unknown>;
  /** Chosen pull interval; `null` when the type is not pull-capable. */
  intervalSeconds: number | null;
  /** Satellite to run a pull source from; `null` = run on core. */
  satelliteId: string | null;
  /** Per-signal stream selection (the binding editor's state). */
  bindings: BindingSelection;
}

/**
 * Whether the editor should offer a "Run from satellite" picker: only a
 * pull-capable type that opted into satellite execution. Webhook-only or
 * satellite-agnostic types run on core and never show the picker.
 */
export function supportsSatellitePicker(
  descriptor: SourceTypeDescriptor,
): boolean {
  return descriptor.supportsSatellite && isPullType(descriptor);
}

/**
 * The `satelliteId` to SEND. For a satellite-capable pull type the editor's
 * value passes through (`null` = core). For any other type the field is
 * irrelevant: create omits it, update leaves it untouched (`undefined`).
 */
function resolveSatelliteId<TNull extends null | undefined>({
  descriptor,
  satelliteId,
  whenNull,
}: {
  descriptor: SourceTypeDescriptor;
  satelliteId: string | null;
  whenNull: TNull;
}): string | TNull | undefined {
  if (!supportsSatellitePicker(descriptor)) return undefined;
  if (satelliteId === null) return whenNull;
  return satelliteId;
}

/**
 * Build the create payload. Bindings come from the multi-signal editor state:
 * one binding per routed signal (`SourceBindings` enforces at least one and at
 * most one per signal; the editor guards both before this runs).
 */
export function buildCreatePayload({
  descriptor,
  values,
  teamId,
}: {
  descriptor: SourceTypeDescriptor;
  values: SourceEditorValues;
  teamId?: string | null;
}): CreateTelemetrySource & { teamId?: string } {
  const description = values.description.trim();
  return {
    sourceTypeId: descriptor.id,
    name: values.name.trim(),
    description: description.length > 0 ? description : undefined,
    config: values.config,
    bindings: bindingsToArray({ descriptor, selection: values.bindings }),
    enabled: true,
    intervalSeconds: resolveInterval({
      descriptor,
      intervalSeconds: values.intervalSeconds,
      whenNull: undefined,
    }),
    satelliteId: resolveSatelliteId({
      descriptor,
      satelliteId: values.satelliteId,
      whenNull: undefined,
    }),
    teamId: teamId ?? undefined,
  };
}

/**
 * Build the update payload. Blank keep-existing secrets are stripped so an
 * empty secret input KEEPS the stored value; a field the user explicitly
 * cleared carries `SECRET_CLEAR_SENTINEL` and is preserved for the backend's
 * secret-merge. Bindings are emitted from the editor state: the backend
 * re-authorizes every binding (added AND kept) via the owning sink, so the
 * caller must still manage each bound stream.
 */
export function buildUpdatePayload({
  descriptor,
  values,
  source,
}: {
  descriptor: SourceTypeDescriptor;
  values: SourceEditorValues;
  source: TelemetrySource;
}): UpdateTelemetrySource {
  const description = values.description.trim();
  const config = omitKeepExistingSecrets({
    schema: asConfigSchema(descriptor.configSchema),
    value: values.config,
    keepExistingSecretFields: source.storedSecretFields,
  });
  return {
    name: values.name.trim(),
    description: description.length > 0 ? description : null,
    config,
    bindings: bindingsToArray({ descriptor, selection: values.bindings }),
    intervalSeconds: resolveInterval({
      descriptor,
      intervalSeconds: values.intervalSeconds,
      whenNull: null,
    }),
    satelliteId: resolveSatelliteId({
      descriptor,
      satelliteId: values.satelliteId,
      whenNull: null,
    }),
  };
}
