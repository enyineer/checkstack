import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import { decrypt } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type { InternalEntityKindRegistry } from "../kind-registry";
import type { SecretStore } from "../secret-resolver";
import * as schema from "../schema";
import { reconcileProvider } from "./reconciler";
import { githubScraper } from "../scrapers/github-scraper";
import { gitlabScraper } from "../scrapers/gitlab-scraper";
import { eq } from "drizzle-orm";

type Db = SafeDatabase<typeof schema>;

const SYNC_QUEUE = "gitops-sync";

interface SyncJobPayload {
  providerId: string;
}

interface SyncWorkerDeps {
  db: Db;
  logger: Logger;
  queueManager: QueueManager;
  kindRegistry: InternalEntityKindRegistry;
  secretStore: SecretStore;
}

/**
 * Sets up the GitOps sync worker:
 * 1. Registers a consumer on the `gitops-sync` queue
 * 2. Bootstraps recurring jobs for all existing providers
 */
export async function setupSyncWorker(deps: SyncWorkerDeps): Promise<void> {
  const { db, logger, queueManager, kindRegistry, secretStore } = deps;

  const queue = queueManager.getQueue<SyncJobPayload>(SYNC_QUEUE);

  // Register consumer
  await queue.consume(
    async (job) => {
      const { providerId } = job.data;
      logger.info(`GitOps sync: starting sync for provider ${providerId}`);

      try {
        const result = await runSyncForProvider({
          providerId,
          db,
          logger,
          kindRegistry,
          secretStore,
        });

        logger.info(
          `GitOps sync: completed for provider ${providerId} — ` +
            `created=${result.created} updated=${result.updated} unchanged=${result.unchanged} ` +
            `orphaned=${result.orphaned} deleted=${result.deleted} errors=${result.errors}`,
        );
      } catch (error) {
        logger.error(
          `GitOps sync: failed for provider ${providerId}: ${error}`,
        );
      }
    },
    { consumerGroup: "gitops-sync-worker" },
  );

  // Bootstrap: schedule recurring jobs for all existing providers
  const providers = await db.select().from(schema.providers);

  for (const provider of providers) {
    await scheduleSyncForProvider({
      queueManager,
      providerId: provider.id,
      syncIntervalSeconds: provider.syncInterval,
    });
  }

  logger.info(
    `GitOps sync worker initialized. ${providers.length} provider(s) scheduled.`,
  );
}

/**
 * Loads a provider from DB and runs the reconciliation cycle.
 */
async function runSyncForProvider(params: {
  providerId: string;
  db: Db;
  logger: Logger;
  kindRegistry: InternalEntityKindRegistry;
  secretStore: SecretStore;
}) {
  const { providerId, db, logger, kindRegistry, secretStore } = params;

  const rows = await db
    .select()
    .from(schema.providers)
    .where(eq(schema.providers.id, providerId));

  const provider = rows[0];
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`);
  }

  const scraper =
    provider.type === "github" ? githubScraper : gitlabScraper;

  // Decrypt authToken from database (stored encrypted via DynamicForm secret field)
  let authToken: string | undefined;
  if (provider.authToken) {
    try {
      authToken = decrypt(provider.authToken);
    } catch (error) {
      logger.error(
        `GitOps sync: failed to decrypt authToken for provider ${providerId}: ${error}`,
      );
      throw new Error(`Failed to decrypt auth token for provider ${providerId}`);
    }
  }

  return reconcileProvider({
    providerId: provider.id,
    providerType: provider.type,
    target: provider.target,
    pathPattern: provider.pathPattern,
    authToken,
    baseUrl: provider.baseUrl ?? undefined,
    deletionPolicy: provider.deletionPolicy,
    db,
    logger,
    kindRegistry,
    secretStore,
    scraper,
  });
}

/**
 * Schedules (or updates) a recurring sync job for a provider.
 * Called during bootstrap and when providers are created/updated.
 */
export async function scheduleSyncForProvider(params: {
  queueManager: QueueManager;
  providerId: string;
  syncIntervalSeconds: number;
}): Promise<void> {
  const { queueManager, providerId, syncIntervalSeconds } = params;
  const queue = queueManager.getQueue<SyncJobPayload>(SYNC_QUEUE);

  await queue.scheduleRecurring(
    { providerId },
    {
      jobId: `gitops-sync-${providerId}`,
      intervalSeconds: syncIntervalSeconds,
    },
  );
}

/**
 * Enqueues a one-off sync job for a provider (used by triggerSync RPC).
 */
export async function triggerSyncForProvider(params: {
  queueManager: QueueManager;
  providerId: string;
}): Promise<void> {
  const { queueManager, providerId } = params;
  const queue = queueManager.getQueue<SyncJobPayload>(SYNC_QUEUE);

  await queue.enqueue(
    { providerId },
    { jobId: `gitops-sync-${providerId}-manual` },
  );
}
