import { z } from "zod";
import { isSecretSchema } from "@checkstack/backend-api";
import {
  walkSecretFields,
  type InternalSecretsService,
  type SecretResolverService,
} from "@checkstack/secrets-backend";
import {
  healthcheckSecretMarker,
  isHealthcheckSecretMarker,
  healthcheckSecretFieldPath,
  isSecretReference,
  type CollectorConfigEntry,
} from "@checkstack/healthcheck-common";

// Re-export the marker vocabulary (defined in healthcheck-common so the
// satellite runtime shares it) for this package's own consumers and tests.
export {
  healthcheckSecretMarker,
  isHealthcheckSecretMarker,
} from "@checkstack/healthcheck-common";

/**
 * Credential handling for health-check configurations, mirroring the
 * integration-backend connection-credential pattern (the ONE secrets
 * channel):
 *
 * - An INLINE operator-typed secret is extracted into an INTERNAL secret on
 *   write and represented in the stored config by a marker. The stored row
 *   never holds the raw value.
 * - A `${{ secrets.NAME }}` REFERENCE stays as-is in the stored config and
 *   resolves through the active backend at run time.
 * - UI/AI reads get the config REDACTED (secret fields removed entirely);
 *   the editor treats a blank secret as "keep existing".
 * - The run paths (core executor, satellite JIT channel) INFLATE markers and
 *   references back to real values, in memory only.
 *
 * Everything is schema-driven off `x-secret` fields via the shared
 * `walkSecretFields` machinery - no per-strategy logic.
 */

const fieldPathFromMarker = healthcheckSecretFieldPath;

/**
 * Scope of a secret within a configuration: the strategy config itself, or
 * one collector entry's config (keyed by the entry's stable UUID, which
 * survives collector re-ordering).
 */
export type SecretScope =
  | { kind: "strategy" }
  | { kind: "collector"; entryId: string };

/** Internal-secret name parts for a health-check config credential field. */
export function healthcheckSecretParts({
  configurationId,
  scope,
  fieldPath,
}: {
  configurationId: string;
  scope: SecretScope;
  fieldPath: string;
}): string[] {
  return scope.kind === "strategy"
    ? ["healthcheck", configurationId, "strategy", fieldPath]
    : ["healthcheck", configurationId, "collector", scope.entryId, fieldPath];
}

export interface HealthCheckSecretsDeps {
  internalSecrets: InternalSecretsService;
  /** Only the per-run resolution surface is needed (narrows test fakes). */
  secretResolver: Pick<SecretResolverService, "resolveForRun">;
}

/** Resolve a collector entry's config schema, or undefined when unknown. */
export type GetCollectorSchema = (
  collectorId: string,
) => z.ZodTypeAny | undefined;

// ============================================================================
// EXTRACT (write path)
// ============================================================================

/**
 * Extract inline `x-secret` values from ONE config object into internal
 * secrets, replacing each with a marker. References and existing markers are
 * left untouched (idempotent). Returns the rewritten config and how many
 * values moved.
 */
async function extractOne({
  configurationId,
  scope,
  schema,
  config,
  internalSecrets,
}: {
  configurationId: string;
  scope: SecretScope;
  schema: z.ZodTypeAny;
  config: Record<string, unknown>;
  internalSecrets: InternalSecretsService;
}): Promise<{ config: Record<string, unknown>; extracted: number }> {
  let extracted = 0;
  const rewritten = await walkSecretFields({
    value: config,
    schema,
    visit: async ({ path, value }) => {
      if (isHealthcheckSecretMarker(value) || isSecretReference(value)) {
        return value;
      }
      if (value.length === 0) return value;
      await internalSecrets.set({
        parts: healthcheckSecretParts({ configurationId, scope, fieldPath: path }),
        value,
      });
      extracted++;
      return healthcheckSecretMarker(path);
    },
  });
  return { config: rewritten as Record<string, unknown>, extracted };
}

/**
 * Extract inline secrets from a configuration's strategy config AND every
 * collector entry's config. Returns the rewritten pair, ready to store.
 */
export async function extractConfigurationSecrets({
  configurationId,
  strategySchema,
  config,
  collectors,
  getCollectorSchema,
  internalSecrets,
}: {
  configurationId: string;
  strategySchema: z.ZodTypeAny;
  config: Record<string, unknown>;
  collectors: CollectorConfigEntry[] | undefined;
  getCollectorSchema: GetCollectorSchema;
  internalSecrets: InternalSecretsService;
}): Promise<{
  config: Record<string, unknown>;
  collectors: CollectorConfigEntry[] | undefined;
  extracted: number;
}> {
  let extracted = 0;

  const strategyResult = await extractOne({
    configurationId,
    scope: { kind: "strategy" },
    schema: strategySchema,
    config,
    internalSecrets,
  });
  extracted += strategyResult.extracted;

  let rewrittenCollectors = collectors;
  if (collectors?.length) {
    rewrittenCollectors = await Promise.all(
      collectors.map(async (entry) => {
        const schema = getCollectorSchema(entry.collectorId);
        if (!schema) return entry;
        const result = await extractOne({
          configurationId,
          scope: { kind: "collector", entryId: entry.id },
          schema,
          config: entry.config,
          internalSecrets,
        });
        extracted += result.extracted;
        return { ...entry, config: result.config };
      }),
    );
  }

  return { config: strategyResult.config, collectors: rewrittenCollectors, extracted };
}

// ============================================================================
// INFLATE (run path)
// ============================================================================

/**
 * Inflate ONE stored config's secret fields to their real values: a marker
 * resolves from the internal store, a reference through the active secrets
 * backend, and a bare literal (pre-backfill legacy) passes through. Returns
 * the inflated config plus every resolved value (for output masking).
 *
 * Fail-closed: a marker whose internal secret is missing throws - running
 * a probe with the literal marker string as a credential would both fail
 * confusingly and leak the marker format to the target.
 */
export async function inflateConfigSecrets({
  configurationId,
  scope,
  schema,
  config,
  deps,
}: {
  configurationId: string;
  scope: SecretScope;
  schema: z.ZodTypeAny;
  config: Record<string, unknown>;
  deps: HealthCheckSecretsDeps;
}): Promise<{ config: Record<string, unknown>; values: string[] }> {
  const values: string[] = [];
  const inflated = await walkSecretFields({
    value: config,
    schema,
    visit: async ({ value }) => {
      let resolved = value;
      if (isHealthcheckSecretMarker(value)) {
        const fieldPath = fieldPathFromMarker(value);
        const got = await deps.internalSecrets.get({
          parts: healthcheckSecretParts({ configurationId, scope, fieldPath }),
        });
        if (got === undefined) {
          throw new Error(
            `Health check ${configurationId}: internal secret for "${fieldPath}" not found.`,
          );
        }
        resolved = got;
      } else if (isSecretReference(value)) {
        const { env } = await deps.secretResolver.resolveForRun({
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
 * Resolve a config's secret fields to a `fieldPath -> value` map WITHOUT
 * rewriting the config - the shape the satellite JIT channel replies with.
 * Only markers and references produce entries; a legacy bare literal is
 * omitted (the consumer already holds it verbatim). Fail-closed like
 * inflation: a marker whose internal secret is missing throws.
 */
export async function collectConfigSecretValues({
  configurationId,
  scope,
  schema,
  config,
  deps,
}: {
  configurationId: string;
  scope: SecretScope;
  schema: z.ZodTypeAny;
  config: Record<string, unknown>;
  deps: HealthCheckSecretsDeps;
}): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  await walkSecretFields({
    value: config,
    schema,
    visit: async ({ path, value }) => {
      if (isHealthcheckSecretMarker(value)) {
        const fieldPath = fieldPathFromMarker(value);
        const got = await deps.internalSecrets.get({
          parts: healthcheckSecretParts({ configurationId, scope, fieldPath }),
        });
        if (got === undefined) {
          throw new Error(
            `Health check ${configurationId}: internal secret for "${fieldPath}" not found.`,
          );
        }
        values[path] = got;
      } else if (isSecretReference(value)) {
        const { env } = await deps.secretResolver.resolveForRun({
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
// REDACT (UI/AI read path)
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
 * Remove every `x-secret` field from a config object (recursing into nested
 * objects and arrays-of-objects). The redacted shape is what UI and AI reads
 * receive: the editor renders a blank secret input and treats blank as
 * "keep existing" (`keepExistingSecretFields`), so values - and even the
 * internal marker strings - never reach a browser or a model context.
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
          delete result[key];
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

    return value;
  };

  return walk(schema, config) as Record<string, unknown>;
}

// ============================================================================
// MERGE (update path)
// ============================================================================

/**
 * Restore stored secret values into an incoming (edited) config. The editor
 * round-trips the REDACTED config, so a secret the operator did not retype
 * arrives blank or absent - both mean "keep existing". A non-empty incoming
 * value wins (new secret / new reference). Runs BEFORE validation so
 * conditional requirements (e.g. HTTP basic auth's password) see the
 * restored value, and BEFORE extraction so restored markers pass through
 * extraction untouched.
 *
 * Arrays are paired by index; strategy/collector secret fields live on
 * objects in practice, and a re-ordered array of secret-bearing items is an
 * edit the operator must re-enter.
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

    return incomingValue;
  };

  return walk(schema, incoming, stored) as Record<string, unknown>;
}

/**
 * Merge stored secrets into an incoming configuration update: the strategy
 * config plus each collector entry (paired with the stored entry of the SAME
 * id - a brand-new entry has nothing to restore).
 */
export function mergeConfigurationSecrets({
  strategySchema,
  incomingConfig,
  storedConfig,
  incomingCollectors,
  storedCollectors,
  getCollectorSchema,
}: {
  strategySchema: z.ZodTypeAny;
  incomingConfig: Record<string, unknown>;
  storedConfig: Record<string, unknown> | undefined;
  incomingCollectors: CollectorConfigEntry[] | undefined;
  storedCollectors: CollectorConfigEntry[] | undefined;
  getCollectorSchema: GetCollectorSchema;
}): {
  config: Record<string, unknown>;
  collectors: CollectorConfigEntry[] | undefined;
} {
  const config = mergeSecretFields({
    schema: strategySchema,
    incoming: incomingConfig,
    stored: storedConfig,
  });

  const storedById = new Map(
    (storedCollectors ?? []).map((entry) => [entry.id, entry]),
  );
  const collectors = incomingCollectors?.map((entry) => {
    const schema = getCollectorSchema(entry.collectorId);
    const stored = storedById.get(entry.id);
    if (!schema) return entry;
    return {
      ...entry,
      config: mergeSecretFields({
        schema,
        incoming: entry.config,
        stored: stored?.config,
      }),
    };
  });

  return { config, collectors };
}

// ============================================================================
// CLEANUP (delete path)
// ============================================================================

/**
 * Delete every internal secret a stored configuration's markers point at.
 * References and literals leave nothing behind. Idempotent (the internal
 * store's delete is).
 */
export async function deleteConfigurationSecrets({
  configurationId,
  strategySchema,
  config,
  collectors,
  getCollectorSchema,
  internalSecrets,
}: {
  configurationId: string;
  strategySchema: z.ZodTypeAny;
  config: Record<string, unknown>;
  collectors: CollectorConfigEntry[] | undefined;
  getCollectorSchema: GetCollectorSchema;
  internalSecrets: InternalSecretsService;
}): Promise<void> {
  const deleteMarkers = async (
    scope: SecretScope,
    schema: z.ZodTypeAny,
    value: Record<string, unknown>,
  ) => {
    await walkSecretFields({
      value,
      schema,
      visit: async ({ value: fieldValue }) => {
        if (isHealthcheckSecretMarker(fieldValue)) {
          await internalSecrets.delete({
            parts: healthcheckSecretParts({
              configurationId,
              scope,
              fieldPath: fieldPathFromMarker(fieldValue),
            }),
          });
        }
        return fieldValue;
      },
    });
  };

  await deleteMarkers({ kind: "strategy" }, strategySchema, config);
  for (const entry of collectors ?? []) {
    const schema = getCollectorSchema(entry.collectorId);
    if (!schema) continue;
    await deleteMarkers({ kind: "collector", entryId: entry.id }, schema, entry.config);
  }
}
