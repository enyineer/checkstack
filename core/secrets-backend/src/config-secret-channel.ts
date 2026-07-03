import { z } from "zod";
import { isSecretSchema } from "@checkstack/backend-api";
import { isSecretClearSentinel } from "@checkstack/common";
import {
  isSecretReference,
  configSecretMarker,
  isConfigSecretMarker,
  readConfigSecretMarkerId,
} from "@checkstack/secrets-common";
import { walkSecretFields } from "./walk-secret-fields";
import type { InternalSecretsService } from "./internal-secrets-service";
import type { SecretResolverService } from "./resolver-service";

/**
 * The ONE config-secret extraction channel, shared by every plugin that accepts
 * INLINE secrets in a schema-described config (health-check strategy/collector
 * configs, integration connection configs).
 *
 * A field marked with {@link configSecret} holds exactly one of:
 * - an INLINE operator-typed value → extracted into an internal secret on write,
 *   leaving an opaque MARKER (`${markerPrefix}${secretId}`) in the stored config;
 * - a `${{ secrets.NAME }}` REFERENCE → kept verbatim, resolved through the
 *   active backend at run time;
 * - a legacy bare literal (pre-extraction rows) → passed through.
 *
 * The internal secret is keyed by the field's STABLE `x-secret-id`, never by its
 * name or position - so renaming/moving a field never strands its secret, and a
 * forged marker (one whose embedded id points elsewhere) can only ever resolve
 * the field's OWN slot (extract/inflate key by the schema's id at that leaf).
 *
 * Do NOT confuse this with ConfigService's `configString({ "x-secret": true })`,
 * which encrypts a secret in place for singleton/admin config. See the
 * "secret handling" architecture doc for which mechanism to use.
 */
export interface ConfigSecretChannel {
  /**
   * Marker prefix for this channel. Stored markers are
   * `${markerPrefix}${secretId}`. Choose a channel-unique prefix and NEVER
   * change a released one (existing stored markers would stop resolving).
   */
  markerPrefix: string;
  /**
   * Map a field's stable secret id to the internal-secret name parts. The
   * caller binds the surrounding scope (e.g. config id, provider/connection,
   * collector entry) so the returned parts are globally unique.
   */
  keyParts: (secretId: string) => string[];
}

/** Thrown when an extraction-channel secret field has no `x-secret-id`. */
export class MissingSecretIdError extends Error {
  constructor(path: string) {
    super(
      `Config-secret field "${path}" has no x-secret-id. Declare it with ` +
        `configSecret({ id }) instead of configString({ "x-secret": true }).`,
    );
    this.name = "MissingSecretIdError";
  }
}

// ============================================================================
// EXTRACT (write path)
// ============================================================================

/**
 * Extract inline secrets from ONE config object into internal secrets, replacing
 * each with a marker. References and this field's OWN marker pass through
 * (idempotent). Returns the rewritten config and how many values moved.
 */
export async function extractScopeSecrets({
  channel,
  schema,
  config,
  internalSecrets,
}: {
  channel: ConfigSecretChannel;
  schema: z.ZodTypeAny;
  config: Record<string, unknown>;
  internalSecrets: InternalSecretsService;
}): Promise<{ config: Record<string, unknown>; extracted: number }> {
  let extracted = 0;
  const rewritten = await walkSecretFields({
    value: config,
    schema,
    visit: async ({ path, secretId, value }) => {
      if (secretId === undefined) throw new MissingSecretIdError(path);
      const ownMarker = configSecretMarker(channel.markerPrefix, secretId);
      // Pass through ONLY this field's own marker (a merge/backfill round-trip)
      // or a `${{ secrets.* }}` reference. A marker-shaped value whose embedded
      // id is NOT this field's id is a FORGED marker; extract it into THIS
      // field's slot so it can never resolve another field's secret.
      if (value === ownMarker || isSecretReference(value)) return value;
      if (value.length === 0) return value;
      await internalSecrets.set({ parts: channel.keyParts(secretId), value });
      extracted++;
      return ownMarker;
    },
  });
  return { config: rewritten as Record<string, unknown>, extracted };
}

// ============================================================================
// INFLATE (run path)
// ============================================================================

/**
 * Inflate ONE stored config's secret fields to real values: a marker resolves
 * from the internal store (keyed by the SCHEMA's id at that leaf, never the
 * marker's embedded id), a reference through the active backend, a bare literal
 * passes through. Returns the inflated config plus every resolved value (for
 * output masking). Fail-closed: a marker whose internal secret is missing throws.
 */
export async function inflateScopeSecrets({
  channel,
  schema,
  config,
  internalSecrets,
  secretResolver,
}: {
  channel: ConfigSecretChannel;
  schema: z.ZodTypeAny;
  config: Record<string, unknown>;
  internalSecrets: InternalSecretsService;
  secretResolver: Pick<SecretResolverService, "resolveForRun">;
}): Promise<{ config: Record<string, unknown>; values: string[] }> {
  const values: string[] = [];
  const inflated = await walkSecretFields({
    value: config,
    schema,
    visit: async ({ path, secretId, value }) => {
      let resolved = value;
      if (isConfigSecretMarker(channel.markerPrefix, value)) {
        if (secretId === undefined) throw new MissingSecretIdError(path);
        const got = await internalSecrets.get({ parts: channel.keyParts(secretId) });
        if (got === undefined) {
          throw new Error(`Internal secret for "${secretId}" not found.`);
        }
        resolved = got;
      } else if (isSecretReference(value)) {
        const { env } = await secretResolver.resolveForRun({
          secretEnv: { CRED: value },
        });
        resolved = env.CRED;
      }
      if (resolved.length > 0) values.push(resolved);
      return resolved;
    },
  });
  return { config: inflated as Record<string, unknown>, values };
}

/**
 * Resolve a config's secret fields to a `path -> value` map WITHOUT rewriting
 * the config - the shape a just-in-time channel (e.g. the satellite reply) ships
 * so the remote side can apply values by field position. Only markers and
 * references produce entries. Fail-closed like inflation.
 */
export async function collectScopeSecretValues({
  channel,
  schema,
  config,
  internalSecrets,
  secretResolver,
}: {
  channel: ConfigSecretChannel;
  schema: z.ZodTypeAny;
  config: Record<string, unknown>;
  internalSecrets: InternalSecretsService;
  secretResolver: Pick<SecretResolverService, "resolveForRun">;
}): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  await walkSecretFields({
    value: config,
    schema,
    visit: async ({ path, secretId, value }) => {
      if (isConfigSecretMarker(channel.markerPrefix, value)) {
        if (secretId === undefined) throw new MissingSecretIdError(path);
        const got = await internalSecrets.get({ parts: channel.keyParts(secretId) });
        if (got === undefined) {
          throw new Error(`Internal secret for "${secretId}" not found.`);
        }
        values[path] = got;
      } else if (isSecretReference(value)) {
        const { env } = await secretResolver.resolveForRun({
          secretEnv: { CRED: value },
        });
        values[path] = env.CRED;
      }
      return value;
    },
  });
  return values;
}

// ============================================================================
// REDACT / MERGE / SIGNAL (schema-only, channel-agnostic)
// ============================================================================

function unwrapZod(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = current.def.innerType as z.ZodTypeAny;
      continue;
    }
    return current;
  }
}

/**
 * Resolve the concrete union branch a value inhabits, mirroring
 * `walkSecretFields`: a discriminated union picks by discriminator literal, a
 * plain union by the first option that parses. Undefined for a non-union schema.
 */
function matchUnionOption(
  schema: z.ZodTypeAny,
  value: unknown,
): z.ZodTypeAny | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const discriminator = (schema.def as { discriminator: string }).discriminator;
    const discriminatorValue = (value as Record<string, unknown>)[discriminator];
    const options = schema.options as z.ZodObject<z.ZodRawShape>[];
    return options.find((option) => {
      const discField = option.shape[discriminator];
      return discField instanceof z.ZodLiteral
        ? discField.value === discriminatorValue
        : false;
    });
  }
  if (schema instanceof z.ZodUnion) {
    const options = schema.options as z.ZodTypeAny[];
    return options.find((option) => option.safeParse(value).success);
  }
  return undefined;
}

/**
 * Remove every `x-secret` field from a config (recursing objects, arrays, and
 * unions), KEEPING a `${{ secrets.NAME }}` reference verbatim (a pointer, not a
 * value). The redacted shape is what UI/AI reads receive; the editor treats a
 * blank secret as "keep existing". Neither a value nor an internal marker leaks.
 */
export function redactSecretFields({
  schema,
  config,
}: {
  schema: z.ZodTypeAny;
  config: Record<string, unknown>;
}): Record<string, unknown> {
  const walk = (nodeSchema: z.ZodTypeAny, value: unknown): unknown => {
    if (value === null || value === undefined) return value;
    const unwrapped = unwrapZod(nodeSchema);

    if (
      unwrapped instanceof z.ZodObject &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const shape = unwrapped.shape as Record<string, z.ZodTypeAny>;
      const result: Record<string, unknown> = {
        ...(value as Record<string, unknown>),
      };
      for (const [key, fieldSchema] of Object.entries(shape)) {
        if (!(key in result)) continue;
        if (isSecretSchema(fieldSchema)) {
          const fieldValue = result[key];
          const isReference =
            typeof fieldValue === "string" && isSecretReference(fieldValue);
          if (!isReference) delete result[key];
          continue;
        }
        result[key] = walk(fieldSchema, result[key]);
      }
      return result;
    }

    if (unwrapped instanceof z.ZodArray && Array.isArray(value)) {
      const elementSchema = unwrapped.element as z.ZodTypeAny;
      return value.map((item) => walk(elementSchema, item));
    }

    const option = matchUnionOption(unwrapped, value);
    if (option) return walk(option, value);

    return value;
  };

  return walk(schema, config) as Record<string, unknown>;
}

/**
 * Restore stored secret values into an incoming (edited) config. A blank/absent
 * secret means "keep existing"; a non-empty value wins; the CLEAR sentinel drops
 * the field (positively remove). Runs before validation and extraction. Descends
 * objects, index-paired arrays, and unions.
 */
export function mergeSecretFields({
  schema,
  incoming,
  stored,
}: {
  schema: z.ZodTypeAny;
  incoming: Record<string, unknown>;
  stored: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  const walk = (
    nodeSchema: z.ZodTypeAny,
    incomingValue: unknown,
    storedValue: unknown,
  ): unknown => {
    const unwrapped = unwrapZod(nodeSchema);

    if (isSecretSchema(nodeSchema)) {
      if (isSecretClearSentinel(incomingValue)) return undefined;
      const incomingIsSet =
        typeof incomingValue === "string" && incomingValue.trim() !== "";
      if (incomingIsSet) return incomingValue;
      const storedIsSet =
        typeof storedValue === "string" && storedValue.trim() !== "";
      return storedIsSet ? storedValue : incomingValue;
    }

    if (
      unwrapped instanceof z.ZodObject &&
      typeof incomingValue === "object" &&
      incomingValue !== null &&
      !Array.isArray(incomingValue)
    ) {
      const storedRecord =
        typeof storedValue === "object" &&
        storedValue !== null &&
        !Array.isArray(storedValue)
          ? (storedValue as Record<string, unknown>)
          : undefined;
      const shape = unwrapped.shape as Record<string, z.ZodTypeAny>;
      const result: Record<string, unknown> = {
        ...(incomingValue as Record<string, unknown>),
      };
      for (const [key, fieldSchema] of Object.entries(shape)) {
        const merged = walk(fieldSchema, result[key], storedRecord?.[key]);
        if (merged === undefined && !(key in result)) continue;
        result[key] = merged;
      }
      return result;
    }

    if (unwrapped instanceof z.ZodArray && Array.isArray(incomingValue)) {
      const storedArray = Array.isArray(storedValue) ? storedValue : [];
      const elementSchema = unwrapped.element as z.ZodTypeAny;
      return incomingValue.map((item, index) =>
        walk(elementSchema, item, storedArray[index]),
      );
    }

    const option = matchUnionOption(unwrapped, incomingValue);
    if (option) return walk(option, incomingValue, storedValue);

    return incomingValue;
  };

  return walk(schema, incoming, stored) as Record<string, unknown>;
}

/**
 * The TOP-LEVEL `x-secret` field keys of a config that actually hold a stored
 * value (marker, reference, or legacy literal - any non-empty string). Lets a
 * UI tell a stored secret from a never-set optional one. Keys only, never values.
 */
export function listPopulatedSecretKeys({
  schema,
  config,
}: {
  schema: z.ZodTypeAny;
  config: Record<string, unknown>;
}): string[] {
  const obj = unwrapZod(schema);
  if (!(obj instanceof z.ZodObject)) return [];
  const shape = obj.shape as Record<string, z.ZodTypeAny>;
  return Object.entries(shape)
    .filter(([key, fieldSchema]) => {
      if (!isSecretSchema(fieldSchema)) return false;
      const value = config[key];
      return typeof value === "string" && value.length > 0;
    })
    .map(([key]) => key);
}

// ============================================================================
// CLEANUP (schema-free: delete + orphan prune)
// ============================================================================

/**
 * Scan ONE config for markers WITHOUT a schema, keying each by the STABLE id
 * embedded in the marker (via the channel). Schema-free is load-bearing for
 * cleanup: an unregistered plugin has no schema to walk, but its stored markers
 * still index live internal secrets that must be deleted, never orphaned.
 */
function scanScopeMarkers({
  channel,
  value,
}: {
  channel: ConfigSecretChannel;
  value: unknown;
}): string[][] {
  const parts: string[][] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      if (isConfigSecretMarker(channel.markerPrefix, node)) {
        parts.push(
          channel.keyParts(readConfigSecretMarkerId(channel.markerPrefix, node)),
        );
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === "object") {
      for (const child of Object.values(node)) walk(child);
    }
  };
  walk(value);
  return parts;
}

const partsKey = (parts: string[]): string => JSON.stringify(parts);

/**
 * Delete every internal secret ONE config's markers point at. Schema-free, so it
 * cleans up even when the owning plugin is uninstalled. Idempotent.
 */
export async function deleteScopeSecrets({
  channel,
  config,
  internalSecrets,
}: {
  channel: ConfigSecretChannel;
  config: Record<string, unknown>;
  internalSecrets: InternalSecretsService;
}): Promise<void> {
  for (const parts of scanScopeMarkers({ channel, value: config })) {
    await internalSecrets.delete({ parts });
  }
}

/**
 * Delete internal secrets ORPHANED by an update to ONE config scope: an old
 * marker whose exact internal-secret coordinates are absent from the new config.
 * Compares by exact `parts` (injective in the secret id), so two fields whose
 * ids are in a prefix relationship never collide. Schema-free on both sides, so
 * a marker preserved under an uninstalled plugin is correctly kept. Returns the
 * number deleted.
 */
export async function pruneScopeSecrets({
  channel,
  oldConfig,
  newConfig,
  internalSecrets,
}: {
  channel: ConfigSecretChannel;
  oldConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
  internalSecrets: InternalSecretsService;
}): Promise<number> {
  const newKeys = new Set(
    scanScopeMarkers({ channel, value: newConfig }).map((parts) =>
      partsKey(parts),
    ),
  );
  let deleted = 0;
  for (const parts of scanScopeMarkers({ channel, value: oldConfig })) {
    if (newKeys.has(partsKey(parts))) continue;
    await internalSecrets.delete({ parts });
    deleted++;
  }
  return deleted;
}
