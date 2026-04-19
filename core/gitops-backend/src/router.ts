import { implement, ORPCError } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext } from "@checkstack/backend-api";
import { encrypt, decrypt } from "@checkstack/backend-api";
import { gitopsContract } from "@checkstack/gitops-common";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import { triggerSyncForProvider } from "./sync/sync-worker";
import * as schema from "./schema";
import { eq, and } from "drizzle-orm";
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
}

export const createGitOpsRouter = ({ database: db, queueManager }: GitOpsRouterDeps) => {
  // ─── Provenance ──────────────────────────────────────────────────────

  const getProvenance = os.getProvenance.handler(async ({ input }) => {
    const result = await db
      .select()
      .from(schema.provenance)
      .where(
        and(
          eq(schema.provenance.kind, input.kind),
          eq(schema.provenance.entityName, input.entityName),
        ),
      );
    // eslint-disable-next-line unicorn/no-null
    return result[0] ?? null;
  });

  const listProvenance = os.listProvenance.handler(async ({ input }) => {
    const rows = await db.select().from(schema.provenance);
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

      // TODO(phase-2): Call the kind's delete reconciler before removing provenance
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

    return { success: true };
  });

  const deleteSecret = os.deleteSecret.handler(async ({ input }) => {
    await db
      .delete(schema.secrets)
      .where(eq(schema.secrets.id, input.id));

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

  // ─── Build Router ────────────────────────────────────────────────────

  return os.router({
    getProvenance,
    listProvenance,
    listProviders,
    triggerSync,
    confirmOrphanDeletion,
    dismissOrphan,
    listSecrets,
    createSecret,
    rotateSecret,
    deleteSecret,
    resolveSecret,
  });
};

export type GitOpsRouter = ReturnType<typeof createGitOpsRouter>;
