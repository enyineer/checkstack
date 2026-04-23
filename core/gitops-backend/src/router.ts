import { implement, ORPCError } from "@orpc/server";
import { z } from "zod";
import { autoAuthMiddleware, type RpcContext } from "@checkstack/backend-api";
import { encrypt, decrypt } from "@checkstack/backend-api";
import { gitopsContract } from "@checkstack/gitops-common";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type { InternalEntityKindRegistry } from "./kind-registry";
import { triggerSyncForProvider, scheduleSyncForProvider, cancelSyncForProvider } from "./sync/sync-worker";
import * as schema from "./schema";
import { eq, and, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

/**
 * Creates the GitOps router using contract-based implementation.
 *
 * Auth and access rules are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.access.
 */
const os = implement(gitopsContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

export interface GitOpsRouterDeps {
  database: SafeDatabase<typeof schema>;
  queueManager: QueueManager;
  kindRegistry: InternalEntityKindRegistry;
}

export const createGitOpsRouter = ({
  database: db,
  queueManager,
  kindRegistry,
}: GitOpsRouterDeps) => {
  // ─── Provenance ──────────────────────────────────────────────────────

  const getProvenance = os.getProvenance.handler(async ({ input }) => {
    const conditions = [eq(schema.provenance.kind, input.kind)];

    if (input.entityName) {
      conditions.push(eq(schema.provenance.entityName, input.entityName));
    }
    if (input.entityId) {
      conditions.push(eq(schema.provenance.entityId, input.entityId));
    }

    const result = await db
      .select()
      .from(schema.provenance)
      .where(and(...conditions));
    const row = result[0];
    // eslint-disable-next-line unicorn/no-null
    return row ? { ...row, warnings: row.warnings ?? [] } : null;
  });

  const listProvenance = os.listProvenance.handler(async ({ input }) => {
    const rawRows = await db.select().from(schema.provenance);
    // Normalize: ensure warnings is always a string[] (Drizzle may return null for pre-migration rows)
    const rows = rawRows.map((row) => ({ ...row, warnings: row.warnings ?? [] }));
    if (!input) return rows;

    return rows.filter((row) => {
      if (input.status && row.status !== input.status) return false;
      if (input.providerId && row.providerId !== input.providerId) return false;
      return true;
    });
  });

  // ─── Provider Management ─────────────────────────────────────────────

  const listProviders = os.listProviders.handler(async () => {
    const rows = await db.select().from(schema.providers);
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      target: r.target,
      pathPattern: r.pathPattern,
      baseUrl: r.baseUrl,
      syncInterval: r.syncInterval,
      deletionPolicy: r.deletionPolicy,
      lastSyncAt: r.lastSyncAt,
      lastSyncError: r.lastSyncError,
      createdAt: r.createdAt,
    }));
  });

  const createProvider = os.createProvider.handler(async ({ input }) => {
    const id = uuidv4();
    const syncInterval = input.syncInterval ?? 300;
    await db.insert(schema.providers).values({
      id,
      type: input.type,
      target: input.target,
      pathPattern: input.pathPattern,
      baseUrl: input.baseUrl ?? null, // eslint-disable-line unicorn/no-null
      authToken: input.authToken ? encrypt(input.authToken) : null, // eslint-disable-line unicorn/no-null
      syncInterval,
      deletionPolicy: input.deletionPolicy ?? "orphan",
    });

    // Schedule recurring sync for the new provider
    await scheduleSyncForProvider({
      queueManager,
      providerId: id,
      syncIntervalSeconds: syncInterval,
    });

    return { id };
  });

  const updateProvider = os.updateProvider.handler(async ({ input }) => {
    const existing = await db
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.id, input.id));

    if (!existing[0]) {
      throw new ORPCError("NOT_FOUND", {
        message: `Provider not found: ${input.id}`,
      });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.data.target !== undefined) updates.target = input.data.target;
    if (input.data.pathPattern !== undefined)
      updates.pathPattern = input.data.pathPattern;
    if (input.data.baseUrl !== undefined) updates.baseUrl = input.data.baseUrl;
    if (input.data.authToken !== undefined) {
      // null = explicitly clear token, string = encrypt and store
      // eslint-disable-next-line unicorn/no-null
      updates.authToken = input.data.authToken ? encrypt(input.data.authToken) : null;
    }
    if (input.data.syncInterval !== undefined)
      updates.syncInterval = input.data.syncInterval;
    if (input.data.deletionPolicy !== undefined)
      updates.deletionPolicy = input.data.deletionPolicy;

    await db
      .update(schema.providers)
      .set(updates)
      .where(eq(schema.providers.id, input.id));

    // If syncInterval changed, reschedule the recurring job
    if (input.data.syncInterval !== undefined) {
      await scheduleSyncForProvider({
        queueManager,
        providerId: input.id,
        syncIntervalSeconds: input.data.syncInterval,
      });
    }

    return { success: true };
  });

  const deleteProvider = os.deleteProvider.handler(async ({ input }) => {
    const existing = await db
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.id, input.id));

    if (!existing[0]) {
      throw new ORPCError("NOT_FOUND", {
        message: `Provider not found: ${input.id}`,
      });
    }

    // Provenance entries are cascade-deleted via FK constraint
    await db.delete(schema.providers).where(eq(schema.providers.id, input.id));

    // Cancel the recurring sync job
    await cancelSyncForProvider({
      queueManager,
      providerId: input.id,
    });

    return { success: true };
  });

  const triggerSync = os.triggerSync.handler(async ({ input }) => {
    // Verify provider exists
    const provider = await db
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.id, input.providerId));

    if (!provider[0]) {
      throw new ORPCError("NOT_FOUND", {
        message: `Provider not found: ${input.providerId}`,
      });
    }

    // Dispatch one-off sync job via the queue
    await triggerSyncForProvider({
      queueManager,
      providerId: input.providerId,
    });

    return { success: true };
  });

  const confirmOrphanDeletion = os.confirmOrphanDeletion.handler(
    async ({ input }) => {
      const rows = await db
        .select()
        .from(schema.provenance)
        .where(eq(schema.provenance.id, input.provenanceId));

      const prov = rows[0];
      if (!prov) {
        throw new ORPCError("NOT_FOUND", {
          message: `Provenance entry not found: ${input.provenanceId}`,
        });
      }

      if (prov.status !== "orphaned") {
        throw new ORPCError("BAD_REQUEST", {
          message: "Only orphaned entities can be confirmed for deletion",
        });
      }

      // Call the kind's delete reconciler before removing provenance
      const kindDef = kindRegistry.getKind({
        apiVersion: prov.apiVersion,
        kind: prov.kind,
      });

      if (kindDef?.delete) {
        try {
          await kindDef.delete({
            entityName: prov.entityName,
            entityId: prov.entityId,
            context: {
              logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {},
              },
              resolveEntityRef: async () => {
                // eslint-disable-next-line unicorn/no-useless-undefined
                return undefined;
              },
              resolveSecretsBySchema: async <T>(params: { value: T; schema: z.ZodTypeAny }): Promise<{ resolved: T; warnings: string[] }> =>
                ({ resolved: params.value, warnings: [] }),
            },
          });
        } catch (deleteError) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: `Delete reconciler failed: ${deleteError}`,
          });
        }
      }

      await db
        .delete(schema.provenance)
        .where(eq(schema.provenance.id, input.provenanceId));

      return { success: true };
    },
  );

  const dismissOrphan = os.dismissOrphan.handler(async ({ input }) => {
    const rows = await db
      .select()
      .from(schema.provenance)
      .where(eq(schema.provenance.id, input.provenanceId));

    if (!rows[0]) {
      throw new ORPCError("NOT_FOUND", {
        message: `Provenance entry not found: ${input.provenanceId}`,
      });
    }

    await db
      .delete(schema.provenance)
      .where(eq(schema.provenance.id, input.provenanceId));

    return { success: true };
  });

  // ─── Secret Management ───────────────────────────────────────────────

  const listSecrets = os.listSecrets.handler(async () => {
    const rows = await db.select().from(schema.secrets);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  });

  const createSecret = os.createSecret.handler(async ({ input }) => {
    // Check for duplicate name
    const existing = await db
      .select()
      .from(schema.secrets)
      .where(eq(schema.secrets.name, input.name));

    if (existing[0]) {
      throw new ORPCError("CONFLICT", {
        message: `Secret with name "${input.name}" already exists`,
      });
    }

    const id = uuidv4();
    const encryptedValue = encrypt(input.value);
    await db.insert(schema.secrets).values({
      id,
      name: input.name,
      encryptedValue,
      description: input.description,
    });
    return { id, name: input.name };
  });

  const rotateSecret = os.rotateSecret.handler(async ({ input }) => {
    const existing = await db
      .select()
      .from(schema.secrets)
      .where(eq(schema.secrets.id, input.id));

    if (!existing[0]) {
      throw new ORPCError("NOT_FOUND", {
        message: `Secret not found: ${input.id}`,
      });
    }

    const encryptedValue = encrypt(input.value);
    await db
      .update(schema.secrets)
      .set({ encryptedValue, updatedAt: new Date() })
      .where(eq(schema.secrets.id, input.id));

    // Invalidate provenance for all entities referencing this secret
    // so the next sync cycle re-reconciles them with the updated value
    const secretName = existing[0].name;
    await db
      .update(schema.provenance)
      .set({ lastSyncHash: "" })
      .where(
        sql`${secretName} = ANY(${schema.provenance.secretRefs})`,
      );

    return { success: true };
  });

  const deleteSecret = os.deleteSecret.handler(async ({ input }) => {
    await db.delete(schema.secrets).where(eq(schema.secrets.id, input.id));

    return { success: true };
  });

  const resolveSecret = os.resolveSecret.handler(async ({ input }) => {
    const rows = await db
      .select()
      .from(schema.secrets)
      .where(eq(schema.secrets.name, input.name));

    const secret = rows[0];
    if (!secret) {
      throw new ORPCError("NOT_FOUND", {
        message: `Secret not found: ${input.name}`,
      });
    }

    return { value: decrypt(secret.encryptedValue) };
  });

  const getSecretUsage = os.getSecretUsage.handler(async ({ input }) => {
    const rows = await db
      .select({
        kind: schema.provenance.kind,
        entityName: schema.provenance.entityName,
        repository: schema.provenance.repository,
        filePath: schema.provenance.filePath,
      })
      .from(schema.provenance)
      .where(
        sql`${input.secretName} = ANY(${schema.provenance.secretRefs})`,
      );

    return rows;
  });

  // ─── Kind Registry ────────────────────────────────────────────────────

  const listKinds = os.listKinds.handler(async () => {
    return kindRegistry.describeKinds();
  });

  // ─── Build Router ────────────────────────────────────────────────────

  return os.router({
    getProvenance,
    listProvenance,
    listProviders,
    createProvider,
    updateProvider,
    deleteProvider,
    triggerSync,
    confirmOrphanDeletion,
    dismissOrphan,
    listSecrets,
    createSecret,
    rotateSecret,
    deleteSecret,
    resolveSecret,
    getSecretUsage,
    listKinds,
  });
};

export type GitOpsRouter = ReturnType<typeof createGitOpsRouter>;
