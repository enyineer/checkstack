import { z } from "zod";
import { type AdvisoryLockService } from "@checkstack/backend-api";
import {
  type InternalSecretsService,
  type SecretResolverService,
  type ConfigSecretChannel,
  extractScopeSecrets,
  inflateScopeSecrets,
  collectScopeSecretValues,
  deleteScopeSecrets,
  pruneScopeSecrets,
  mergeSecretFields,
} from "@checkstack/secrets-backend";
import {
  HEALTHCHECK_SECRET_MARKER_PREFIX,
  type CollectorConfigEntry,
} from "@checkstack/healthcheck-common";

// Re-export the marker vocabulary (defined in healthcheck-common so the
// satellite runtime shares it) and the schema-only channel helpers (defined in
// secrets-backend, the ONE extraction channel) for this package + its tests.
export {
  healthcheckSecretMarker,
  isHealthcheckSecretMarker,
} from "@checkstack/healthcheck-common";
// `mergeSecretFields` is also imported above for local use in this module;
// this re-export surfaces the channel helpers for the package + its tests.
export {
  redactSecretFields,
  mergeSecretFields,
  listPopulatedSecretKeys,
} from "@checkstack/secrets-backend";

/**
 * Health-check config credentials ride the platform's ONE config-secret
 * extraction channel ({@link ConfigSecretChannel} in `@checkstack/secrets-backend`,
 * shared with integration connections). This module only binds that channel to a
 * health-check scope (strategy config, or one collector entry) and orchestrates
 * the strategy + collectors of a whole configuration. Fields are declared with
 * `configSecret({ id })`; the internal secret is keyed by the stable id.
 */

/**
 * Scope of a secret within a configuration: the strategy config itself, or one
 * collector entry's config (keyed by the entry's stable UUID, which survives
 * collector re-ordering).
 */
export type SecretScope =
  | { kind: "strategy" }
  | { kind: "collector"; entryId: string };

/** Internal-secret name parts for a health-check config credential field. */
export function healthcheckSecretParts({
  configurationId,
  scope,
  secretId,
}: {
  configurationId: string;
  scope: SecretScope;
  secretId: string;
}): string[] {
  return scope.kind === "strategy"
    ? ["healthcheck", configurationId, "strategy", secretId]
    : ["healthcheck", configurationId, "collector", scope.entryId, secretId];
}

/** The extraction channel bound to one health-check scope. */
function scopeChannel(
  configurationId: string,
  scope: SecretScope,
): ConfigSecretChannel {
  return {
    markerPrefix: HEALTHCHECK_SECRET_MARKER_PREFIX,
    keyParts: (secretId) =>
      healthcheckSecretParts({ configurationId, scope, secretId }),
  };
}

export interface HealthCheckSecretsDeps {
  internalSecrets: InternalSecretsService;
  /** Only the per-run resolution surface is needed (narrows test fakes). */
  secretResolver: Pick<SecretResolverService, "resolveForRun">;
  /**
   * Optional cluster-wide mutex. When present, `updateConfiguration` and
   * `deleteConfiguration` serialize their read-modify-write-prune for a given
   * config id under a per-id advisory lock, so a concurrent writer to the SAME
   * id cannot have its just-written secret deleted by another writer's stale
   * orphan-prune (which would leave a dangling marker).
   */
  advisoryLock?: AdvisoryLockService;
}

/** Advisory-lock key serializing writes to ONE health-check configuration. */
export function healthcheckConfigLockKey(configurationId: string): string {
  return `healthcheck:config:${configurationId}`;
}

/** Resolve a collector entry's config schema, or undefined when unknown. */
export type GetCollectorSchema = (
  collectorId: string,
) => z.ZodTypeAny | undefined;

// ============================================================================
// EXTRACT (write path)
// ============================================================================

/**
 * Extract inline secrets from a configuration's strategy config AND every
 * collector entry's config into internal secrets, replacing each with a marker.
 * An UNREGISTERED strategy has no schema, so its config passes through unchanged
 * while REGISTERED collectors still extract their own secrets.
 */
export async function extractConfigurationSecrets({
  configurationId,
  strategySchema,
  config,
  collectors,
  getCollectorSchema,
  internalSecrets,
}: {
  strategySchema: z.ZodTypeAny | undefined;
  configurationId: string;
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

  let strategyConfig = config;
  if (strategySchema) {
    const result = await extractScopeSecrets({
      channel: scopeChannel(configurationId, { kind: "strategy" }),
      schema: strategySchema,
      config,
      internalSecrets,
    });
    strategyConfig = result.config;
    extracted += result.extracted;
  }

  let rewrittenCollectors = collectors;
  if (collectors?.length) {
    rewrittenCollectors = await Promise.all(
      collectors.map(async (entry) => {
        const schema = getCollectorSchema(entry.collectorId);
        if (!schema) return entry;
        const result = await extractScopeSecrets({
          channel: scopeChannel(configurationId, {
            kind: "collector",
            entryId: entry.id,
          }),
          schema,
          config: entry.config,
          internalSecrets,
        });
        extracted += result.extracted;
        return { ...entry, config: result.config };
      }),
    );
  }

  return { config: strategyConfig, collectors: rewrittenCollectors, extracted };
}

// ============================================================================
// INFLATE / COLLECT (run path)
// ============================================================================

/** Inflate ONE stored config's secret fields to real values (in memory). */
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
  return inflateScopeSecrets({
    channel: scopeChannel(configurationId, scope),
    schema,
    config,
    internalSecrets: deps.internalSecrets,
    secretResolver: deps.secretResolver,
  });
}

/** Resolve a config's secret fields to a `path -> value` map (satellite JIT). */
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
  return collectScopeSecretValues({
    channel: scopeChannel(configurationId, scope),
    schema,
    config,
    internalSecrets: deps.internalSecrets,
    secretResolver: deps.secretResolver,
  });
}

// ============================================================================
// MERGE (update path)
// ============================================================================

/**
 * Merge stored secrets into an incoming configuration update: the strategy
 * config plus each collector entry (paired with the stored entry of the SAME
 * id - a brand-new entry has nothing to restore). An unregistered strategy has
 * no schema, so its config passes through unchanged.
 */
export function mergeConfigurationSecrets({
  strategySchema,
  incomingConfig,
  storedConfig,
  incomingCollectors,
  storedCollectors,
  getCollectorSchema,
}: {
  strategySchema: z.ZodTypeAny | undefined;
  incomingConfig: Record<string, unknown>;
  storedConfig: Record<string, unknown> | undefined;
  incomingCollectors: CollectorConfigEntry[] | undefined;
  storedCollectors: CollectorConfigEntry[] | undefined;
  getCollectorSchema: GetCollectorSchema;
}): {
  config: Record<string, unknown>;
  collectors: CollectorConfigEntry[] | undefined;
} {
  // Imported lazily-free: mergeSecretFields is re-exported above.
  const config = strategySchema
    ? mergeSecretFields({
        schema: strategySchema,
        incoming: incomingConfig,
        stored: storedConfig,
      })
    : incomingConfig;

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
// CLEANUP (schema-free delete + orphan prune)
// ============================================================================

/** Collector scopes present across an old + new collector list, deduped. */
function collectorScopes(
  ...lists: (CollectorConfigEntry[] | undefined)[]
): { kind: "collector"; entryId: string }[] {
  const ids = new Set<string>();
  for (const list of lists) for (const entry of list ?? []) ids.add(entry.id);
  return [...ids].map((entryId) => ({ kind: "collector", entryId }));
}

/**
 * Delete every internal secret a stored configuration's markers point at (the
 * strategy config plus every collector entry). Schema-free, so it cleans up even
 * when the strategy/collector plugin is uninstalled - a deleted check never
 * orphans its secrets.
 */
export async function deleteConfigurationSecrets({
  configurationId,
  config,
  collectors,
  internalSecrets,
}: {
  configurationId: string;
  config: Record<string, unknown>;
  collectors: CollectorConfigEntry[] | undefined;
  internalSecrets: InternalSecretsService;
}): Promise<void> {
  await deleteScopeSecrets({
    channel: scopeChannel(configurationId, { kind: "strategy" }),
    config,
    internalSecrets,
  });
  const byId = new Map((collectors ?? []).map((e) => [e.id, e]));
  for (const scope of collectorScopes(collectors)) {
    await deleteScopeSecrets({
      channel: scopeChannel(configurationId, scope),
      config: byId.get(scope.entryId)?.config ?? {},
      internalSecrets,
    });
  }
}

/**
 * Delete internal secrets ORPHANED by an update: a cleared/removed field, an
 * inline secret swapped for a reference, or a removed collector. Prunes the
 * strategy scope and every collector scope (old ∪ new), comparing markers by
 * exact internal-secret coordinates. Returns the number deleted.
 */
export async function pruneOrphanedConfigurationSecrets({
  configurationId,
  oldConfig,
  newConfig,
  oldCollectors,
  newCollectors,
  internalSecrets,
}: {
  configurationId: string;
  oldConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
  oldCollectors: CollectorConfigEntry[] | undefined;
  newCollectors: CollectorConfigEntry[] | undefined;
  internalSecrets: InternalSecretsService;
}): Promise<number> {
  let deleted = await pruneScopeSecrets({
    channel: scopeChannel(configurationId, { kind: "strategy" }),
    oldConfig,
    newConfig: newConfig ?? {},
    internalSecrets,
  });

  const oldById = new Map((oldCollectors ?? []).map((e) => [e.id, e]));
  const newById = new Map((newCollectors ?? []).map((e) => [e.id, e]));
  for (const scope of collectorScopes(oldCollectors, newCollectors)) {
    deleted += await pruneScopeSecrets({
      channel: scopeChannel(configurationId, scope),
      oldConfig: oldById.get(scope.entryId)?.config ?? {},
      newConfig: newById.get(scope.entryId)?.config ?? {},
      internalSecrets,
    });
  }
  return deleted;
}
