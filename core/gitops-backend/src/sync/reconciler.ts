import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { EntityEnvelope } from "@checkstack/gitops-common";
import { collectSecretNames } from "@checkstack/gitops-common";
import { z } from "zod";
import type { InternalEntityKindRegistry } from "../kind-registry";
import type { SecretStore } from "../secret-resolver";
import type { DiscoveredFile, Scraper, FetchFn } from "../scrapers/types";
import { parseEntityDocuments } from "./document-parser";
import { sortEntitiesByDependency, type CollectedEntity } from "./sort-entities";
import { resolveSecretsBySchema } from "../secret-resolver";
import * as schema from "../schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

type Db = SafeDatabase<typeof schema>;

// ─── Types ─────────────────────────────────────────────────────────────────

interface ReconcileProviderParams {
  providerId: string;
  providerType: "github" | "gitlab";
  target: string;
  pathPattern: string;
  authToken?: string;
  baseUrl?: string;
  deletionPolicy: "orphan" | "auto";
  db: Db;
  logger: Logger;
  kindRegistry: InternalEntityKindRegistry;
  secretStore: SecretStore;
  scraper: Scraper;
  fetchFn?: FetchFn;
}

interface ReconcileResult {
  created: number;
  updated: number;
  unchanged: number;
  orphaned: number;
  deleted: number;
  errors: number;
}

// ─── Main Reconciler ───────────────────────────────────────────────────────

/**
 * Runs a full reconciliation cycle for a single provider:
 * 1. Scrape files from the Git provider
 * 2. Parse YAML → entity envelopes
 * 3. For each entity: validate → resolve secrets → reconcile → update provenance
 * 4. Detect orphans (provenance entries not seen in this sync)
 */
export async function reconcileProvider(
  params: ReconcileProviderParams,
): Promise<ReconcileResult> {
  const {
    providerId,
    target,
    pathPattern,
    authToken,
    baseUrl,
    deletionPolicy,
    db,
    logger,
    kindRegistry,
    secretStore,
    scraper,
    fetchFn,
  } = params;

  const result: ReconcileResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    orphaned: 0,
    deleted: 0,
    errors: 0,
  };

  // 1. Scrape
  let discoveredFiles: DiscoveredFile[];
  try {
    discoveredFiles = await scraper.discoverFiles({
      target,
      pathPattern,
      authToken,
      baseUrl,
      logger,
      fetch: fetchFn,
    });
  } catch (error) {
    logger.error(
      `Reconciler: scraper failed for provider ${providerId}: ${error}`,
    );
    // Update provider with sync error
    await updateProviderSyncStatus({ db, providerId, error: String(error) });
    throw error;
  }

  logger.debug(
    `Reconciler: scraped ${discoveredFiles.length} file(s) from provider ${providerId}`,
  );

  // 2. Collect all entities from all files
  const seenEntityKeys = new Set<string>();
  const collected: CollectedEntity[] = [];

  for (const file of discoveredFiles) {
    const parseResult = parseEntityDocuments({ content: file.content });

    // Log parse errors
    for (const error of parseResult.errors) {
      logger.error(
        `Reconciler: parse error in ${file.repository}/${file.filePath} (doc ${error.documentIndex}): ${error.message}`,
      );
      result.errors++;
    }

    for (const { entity, contentHash } of parseResult.entities) {
      const entityKey = `${entity.kind}::${entity.metadata.name}`;
      seenEntityKeys.add(entityKey);
      const secretRefs = collectSecretNames({ value: entity.spec });
      collected.push({ entity, contentHash, file, secretRefs });
    }
  }

  // 3. Sort by dependency order (topological sort via entity refs)
  const sorted = sortEntitiesByDependency({ entities: collected });

  // 4. Reconcile in dependency order (provenance written immediately per entity)
  for (const { entity, contentHash, file, secretRefs } of sorted) {
    const entityKey = `${entity.kind}::${entity.metadata.name}`;

    try {
      await reconcileEntity({
        entity,
        contentHash,
        secretRefs: secretRefs ?? [],
        file,
        providerId,
        db,
        logger,
        kindRegistry,
        secretStore,
        result,
      });
    } catch (error) {
      logger.error(
        `Reconciler: error reconciling ${entityKey} from ${file.repository}/${file.filePath}: ${error}`,
      );
      await upsertProvenance({
        db,
        providerId,
        entity,
        file,
        contentHash,
        secretRefs: secretRefs ?? [],
        status: "error",
        errorMessage: String(error),
      });
      result.errors++;
    }
  }

  // 5. Detect orphans
  await detectOrphans({
    db,
    providerId,
    seenEntityKeys,
    deletionPolicy,
    kindRegistry,
    logger,
    result,
  });

  // 6. Update provider sync status
  await updateProviderSyncStatus({ db, providerId });

  return result;
}

// ─── Entity Reconciliation ─────────────────────────────────────────────────

async function reconcileEntity(params: {
  entity: EntityEnvelope;
  contentHash: string;
  secretRefs: string[];
  file: DiscoveredFile;
  providerId: string;
  db: Db;
  logger: Logger;
  kindRegistry: InternalEntityKindRegistry;
  secretStore: SecretStore;
  result: ReconcileResult;
}): Promise<void> {
  const {
    entity,
    contentHash,
    secretRefs,
    file,
    providerId,
    db,
    logger,
    kindRegistry,
    secretStore,
    result,
  } = params;

  // Build resolve function that queries local provenance (no RPC round-trip)
  const resolveEntityRef = async (refParams: {
    kind: string;
    entityName: string;
  }): Promise<string | undefined> => {
    const rows = await db
      .select({ entityId: schema.provenance.entityId })
      .from(schema.provenance)
      .where(
        and(
          eq(schema.provenance.kind, refParams.kind),
          eq(schema.provenance.entityName, refParams.entityName),
          eq(schema.provenance.status, "synced"),
        ),
      );
    return rows[0]?.entityId;
  };

  // Accumulates warnings from all resolveSecretsBySchema calls during this reconciliation
  const reconcileWarnings: string[] = [];

  const context = {
    logger,
    resolveEntityRef,
    resolveSecretsBySchema: async <T>(params: {
      value: T;
      schema: z.ZodTypeAny;
    }): Promise<{ resolved: T; warnings: string[] }> => {
      const result = await resolveSecretsBySchema({
        value: params.value as unknown,
        schema: params.schema,
        secretStore,
      });
      reconcileWarnings.push(...result.warnings);
      return { resolved: result.resolved as T, warnings: result.warnings };
    },
  };

  // Look up registered kind
  const kindDef = kindRegistry.getKind({
    apiVersion: entity.apiVersion,
    kind: entity.kind,
  });

  if (!kindDef) {
    throw new Error(
      `Unknown entity kind: ${entity.kind} (${entity.apiVersion})`,
    );
  }

  // Validate spec against merged schema
  const mergedSchema = kindRegistry.getMergedSpecSchema({
    apiVersion: entity.apiVersion,
    kind: entity.kind,
  });

  const validationResult = mergedSchema.safeParse(entity.spec);
  if (!validationResult.success) {
    throw new Error(
      `Spec validation failed: ${validationResult.error.message}`,
    );
  }

  // Reject secret templates in metadata (display fields must never contain secrets)
  const metadataSecrets = collectSecretNames({ value: entity.metadata });
  if (metadataSecrets.length > 0) {
    throw new Error(
      `Secret templates are not allowed in metadata fields (found: ${metadataSecrets.join(", ")}). ` +
        `Secrets can only be referenced in the spec section.`,
    );
  }

  // Validate all referenced secrets exist before reconciliation.
  // This catches typos / missing secrets early even though resolution is deferred
  // to when the plugin explicitly calls context.resolveSecretsBySchema().
  for (const name of secretRefs) {
    await secretStore.resolve(name);
  }

  // Check provenance for diff
  const existingProvenance = await db
    .select()
    .from(schema.provenance)
    .where(
      and(
        eq(schema.provenance.kind, entity.kind),
        eq(schema.provenance.entityName, entity.metadata.name),
      ),
    );

  const existing = existingProvenance[0];

  if (existing && existing.status === "synced" && existing.lastSyncHash === contentHash) {
    // Unchanged and synced — skip reconciliation
    result.unchanged++;
    return;
  }

  // Call base kind reconciler with raw spec (secrets NOT pre-resolved).
  // Plugins use context.resolveSecretsBySchema() to resolve specific fields.
  const reconcileResult = await kindDef.reconcile({
    entity: entity as typeof entity & { spec: Record<string, unknown> },
    existingEntityId: existing && !existing.entityId.startsWith("pending-") ? existing.entityId : undefined,
    context,
  });

  // Call extension reconcilers for present namespaces
  const extensions = kindRegistry.getExtensions({
    apiVersion: entity.apiVersion,
    kind: entity.kind,
  });

  for (const ext of extensions) {
    const extensionSpec = (entity.spec as Record<string, unknown>)[
      ext.namespace
    ];
    if (extensionSpec !== undefined) {
      await ext.reconcile({
        entity,
        extensionSpec,
        entityId: reconcileResult.entityId,
        context,
      });
    }
  }

  // Update provenance
  await upsertProvenance({
    db,
    providerId,
    entity,
    file,
    contentHash,
    secretRefs,
    entityId: reconcileResult.entityId,
    status: "synced",
    warnings: reconcileWarnings,
  });

  if (existing) {
    result.updated++;
  } else {
    result.created++;
  }
}

// ─── Orphan Detection ──────────────────────────────────────────────────────

async function detectOrphans(params: {
  db: Db;
  providerId: string;
  seenEntityKeys: Set<string>;
  deletionPolicy: "orphan" | "auto";
  kindRegistry: InternalEntityKindRegistry;
  logger: Logger;
  result: ReconcileResult;
}): Promise<void> {
  const { db, providerId, seenEntityKeys, deletionPolicy, logger, result } =
    params;

  const allProvenance = await db
    .select()
    .from(schema.provenance)
    .where(eq(schema.provenance.providerId, providerId));

  for (const prov of allProvenance) {
    const key = `${prov.kind}::${prov.entityName}`;
    if (!seenEntityKeys.has(key)) {
      if (deletionPolicy === "auto") {
        // Call the kind's delete reconciler before removing provenance
        const kindDef = params.kindRegistry.getKind({
          apiVersion: prov.apiVersion,
          kind: prov.kind,
        });

        // Do not call delete reconciler if it's a pending error record
        if (kindDef?.delete && !prov.entityId.startsWith("pending-")) {
          try {
            await kindDef.delete({
              entityName: prov.entityName,
              entityId: prov.entityId,
              context: {
                logger,
                resolveEntityRef: async () => {
                  // eslint-disable-next-line unicorn/no-useless-undefined
                  return undefined;
                },
                resolveSecretsBySchema: async <T>(params: { value: T; schema: z.ZodTypeAny }): Promise<{ resolved: T; warnings: string[] }> =>
                  ({ resolved: params.value, warnings: [] }),
              },
            });
          } catch (deleteError) {
            logger.error(
              `Reconciler: delete reconciler failed for ${key}: ${deleteError}`,
            );
            result.errors++;
            continue;
          }
        }

        await db
          .delete(schema.provenance)
          .where(eq(schema.provenance.id, prov.id));
        result.deleted++;
        logger.debug(
          `Reconciler: auto-deleted orphaned entity ${key} (provider: ${providerId})`,
        );
      } else {
        // Mark as orphaned
        await db
          .update(schema.provenance)
          .set({ status: "orphaned" })
          .where(eq(schema.provenance.id, prov.id));
        result.orphaned++;
        logger.debug(
          `Reconciler: marked entity ${key} as orphaned (provider: ${providerId})`,
        );
      }
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function upsertProvenance(params: {
  db: Db;
  providerId: string;
  entity: EntityEnvelope;
  file: DiscoveredFile;
  contentHash: string;
  secretRefs: string[];
  /** Required for synced status. On error, may be omitted to preserve existing value. */
  entityId?: string;
  status: "synced" | "error";
  errorMessage?: string;
  /** Warnings about unresolved secret templates in non-secret fields. */
  warnings?: string[];
}): Promise<void> {
  const {
    db,
    providerId,
    entity,
    file,
    contentHash,
    secretRefs,
    entityId,
    status,
    errorMessage,
    warnings,
  } = params;
  const existing = await db
    .select()
    .from(schema.provenance)
    .where(
      and(
        eq(schema.provenance.kind, entity.kind),
        eq(schema.provenance.entityName, entity.metadata.name),
      ),
    );

  if (existing[0]) {
    await db
      .update(schema.provenance)
      .set({
        lastSyncHash: contentHash,
        secretRefs,
        // Preserve existing entityId on error retries; update on successful reconcile
        ...(entityId ? { entityId } : {}),
        status,
        errorMessage: errorMessage ?? null,  
        warnings: warnings ?? [],
        repository: file.repository,
        filePath: file.filePath,
        lastSyncedAt: new Date(),
      })
      .where(eq(schema.provenance.id, existing[0].id));
    return;
  }

  // First-time error: no entityId available yet because the entity failed to create.
  // We MUST create a provenance record anyway so the error shows in the UI.
  // We use a "pending-" prefix so the orphan detector knows not to call the delete reconciler.
  const resolvedEntityId = entityId ?? `pending-${uuidv4()}`;

  await db.insert(schema.provenance).values({
    id: uuidv4(),
    apiVersion: entity.apiVersion,
    kind: entity.kind,
    entityName: entity.metadata.name,
    entityId: resolvedEntityId,
    providerId,
    repository: file.repository,
    filePath: file.filePath,
    lastSyncHash: contentHash,
    secretRefs,
    status,
    errorMessage: errorMessage ?? null,  
    warnings: warnings ?? [],
  });
}

async function updateProviderSyncStatus(params: {
  db: Db;
  providerId: string;
  error?: string;
}): Promise<void> {
  const { db, providerId, error } = params;

  await db
    .update(schema.providers)
    .set({
      lastSyncAt: new Date(),
      lastSyncError: error ?? null,  
      updatedAt: new Date(),
    })
    .where(eq(schema.providers.id, providerId));
}
