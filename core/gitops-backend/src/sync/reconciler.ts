import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { EntityEnvelope } from "@checkstack/gitops-common";
import type { InternalEntityKindRegistry } from "../kind-registry";
import type { SecretStore } from "../secret-resolver";
import type { DiscoveredFile, Scraper, FetchFn } from "../scrapers/types";
import { parseEntityDocuments } from "./document-parser";
import { resolveSecrets } from "../secret-resolver";
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
  authToken: string;
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
    logger.error(`Reconciler: scraper failed for provider ${providerId}: ${error}`);
    // Update provider with sync error
    await updateProviderSyncStatus({ db, providerId, error: String(error) });
    throw error;
  }

  logger.debug(
    `Reconciler: scraped ${discoveredFiles.length} file(s) from provider ${providerId}`,
  );

  // 2. Parse all files
  const seenEntityKeys = new Set<string>();

  for (const file of discoveredFiles) {
    const parseResult = parseEntityDocuments({ content: file.content });

    // Log parse errors
    for (const error of parseResult.errors) {
      logger.error(
        `Reconciler: parse error in ${file.repository}/${file.filePath} (doc ${error.documentIndex}): ${error.message}`,
      );
      result.errors++;
    }

    // 3. Process each entity
    for (const { entity, contentHash } of parseResult.entities) {
      const entityKey = `${entity.kind}::${entity.metadata.name}`;
      seenEntityKeys.add(entityKey);

      try {
        await reconcileEntity({
          entity,
          contentHash,
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
          status: "error",
          errorMessage: String(error),
        });
        result.errors++;
      }
    }
  }

  // 4. Detect orphans
  await detectOrphans({
    db,
    providerId,
    seenEntityKeys,
    deletionPolicy,
    kindRegistry,
    logger,
    result,
  });

  // 5. Update provider sync status
  await updateProviderSyncStatus({ db, providerId });

  return result;
}

// ─── Entity Reconciliation ─────────────────────────────────────────────────

async function reconcileEntity(params: {
  entity: EntityEnvelope;
  contentHash: string;
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
    file,
    providerId,
    db,
    logger,
    kindRegistry,
    secretStore,
    result,
  } = params;

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
    throw new Error(`Spec validation failed: ${validationResult.error.message}`);
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

  if (existing && existing.lastSyncHash === contentHash) {
    // Unchanged — skip reconciliation
    result.unchanged++;
    return;
  }

  // Resolve secrets in the spec
  const resolvedSpec = await resolveSecrets({
    spec: entity.spec as Record<string, unknown>,
    secretStore,
  });

  // Call base kind reconciler
  await kindDef.reconcile({
    entity: { ...entity, spec: resolvedSpec },
    context: { logger },
  });

  // Call extension reconcilers for present namespaces
  const extensions = kindRegistry.getExtensions({
    apiVersion: entity.apiVersion,
    kind: entity.kind,
  });

  for (const ext of extensions) {
    const extensionSpec = (resolvedSpec as Record<string, unknown>)[
      ext.namespace
    ];
    if (extensionSpec !== undefined) {
      await ext.reconcile({
        entity: { ...entity, spec: resolvedSpec },
        extensionSpec,
        context: { logger },
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
    status: "synced",
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

        if (kindDef?.delete) {
          try {
            await kindDef.delete({
              entityName: prov.entityName,
              context: { logger },
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
  status: "synced" | "error";
  errorMessage?: string;
}): Promise<void> {
  const { db, providerId, entity, file, contentHash, status, errorMessage } =
    params;
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
        status,
        errorMessage: errorMessage ?? null, // eslint-disable-line unicorn/no-null
        repository: file.repository,
        filePath: file.filePath,
        lastSyncedAt: new Date(),
      })
      .where(eq(schema.provenance.id, existing[0].id));
    return;
  }

  await db.insert(schema.provenance).values({
    id: uuidv4(),
    apiVersion: entity.apiVersion,
    kind: entity.kind,
    entityName: entity.metadata.name,
    providerId,
    repository: file.repository,
    filePath: file.filePath,
    lastSyncHash: contentHash,
    status,
    errorMessage: errorMessage ?? null, // eslint-disable-line unicorn/no-null
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
      lastSyncError: error ?? null, // eslint-disable-line unicorn/no-null
      updatedAt: new Date(),
    })
    .where(eq(schema.providers.id, providerId));
}
