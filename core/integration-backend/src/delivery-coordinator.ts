import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "@checkmate-monitor/backend-api";
import type { QueueManager } from "@checkmate-monitor/queue-api";
import type { SignalService } from "@checkmate-monitor/signal-common";
import { eq, sql } from "drizzle-orm";

import type { IntegrationProviderRegistry } from "./provider-registry";
import type { ConnectionStore } from "./connection-store";
import * as schema from "./schema";
import { INTEGRATION_DELIVERY_COMPLETED } from "@checkmate-monitor/integration-common";

/**
 * Event payload for delivery routing
 */
export interface IntegrationEventPayload {
  eventId: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/**
 * Job data for the delivery queue
 */
interface DeliveryJobData {
  logId: string;
  subscriptionId: string;
  subscriptionName: string;
  providerId: string;
  providerConfig: Record<string, unknown>;
  eventId: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/**
 * Delivery coordinator - routes events to subscriptions and manages delivery via queue
 */
export interface DeliveryCoordinator {
  /**
   * Route an event to all matching subscriptions.
   * This is called by the hook subscriber when a registered event is emitted.
   */
  routeEvent(event: IntegrationEventPayload): Promise<void>;

  /**
   * Start the delivery worker that processes queued deliveries.
   * Must be called during afterPluginsReady.
   */
  startWorker(): Promise<void>;

  /**
   * Retry a specific failed delivery
   */
  retryDelivery(logId: string): Promise<{ success: boolean; message?: string }>;
}

interface DeliveryCoordinatorDeps {
  db: NodePgDatabase<typeof schema>;
  providerRegistry: IntegrationProviderRegistry;
  connectionStore: ConnectionStore;
  queueManager: QueueManager;
  signalService: SignalService;
  logger: Logger;
}

/**
 * Create a delivery coordinator instance
 */
export function createDeliveryCoordinator(
  deps: DeliveryCoordinatorDeps
): DeliveryCoordinator {
  const {
    db,
    providerRegistry,
    connectionStore,
    queueManager,
    signalService,
    logger,
  } = deps;

  const QUEUE_NAME = "integration-delivery";
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [60_000, 300_000, 900_000]; // 1min, 5min, 15min

  /**
   * Find all subscriptions that match the given event
   */
  async function findMatchingSubscriptions(
    eventId: string,
    payload: Record<string, unknown>
  ) {
    // Get all enabled subscriptions
    const subscriptions = await db
      .select()
      .from(schema.webhookSubscriptions)
      .where(eq(schema.webhookSubscriptions.enabled, true));

    // Filter to those that match this event
    return subscriptions.filter((sub) => {
      // Check event type filter (empty array = all events)
      if (sub.eventTypes.length > 0 && !sub.eventTypes.includes(eventId)) {
        return false;
      }

      // Check system filter if present
      if (sub.systemFilter && sub.systemFilter.length > 0) {
        const systemId = payload["systemId"] as string | undefined;
        if (!systemId || !sub.systemFilter.includes(systemId)) {
          return false;
        }
      }

      // Check if provider supports this event
      const provider = providerRegistry.getProvider(sub.providerId);
      if (!provider) {
        logger.warn(
          `Provider not found for subscription ${sub.id}: ${sub.providerId}`
        );
        return false;
      }

      if (
        provider.supportedEvents &&
        !provider.supportedEvents.includes(eventId)
      ) {
        return false;
      }

      return true;
    });
  }

  /**
   * Execute delivery for a single job
   */
  async function executeDelivery(job: DeliveryJobData): Promise<void> {
    const provider = providerRegistry.getProvider(job.providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${job.providerId}`);
    }

    // Update log to show attempt in progress
    await db
      .update(schema.deliveryLogs)
      .set({
        status: "retrying",
        attempts: sql`${schema.deliveryLogs.attempts} + 1`,
        lastAttemptAt: new Date(),
      })
      .where(eq(schema.deliveryLogs.id, job.logId));

    try {
      // Call the provider's deliver method
      const result = await provider.deliver({
        event: {
          eventId: job.eventId,
          payload: job.payload,
          timestamp: job.timestamp,
          deliveryId: job.logId,
        },
        subscription: {
          id: job.subscriptionId,
          name: job.subscriptionName,
        },
        providerConfig: job.providerConfig,
        logger: logger,
        getConnectionWithCredentials:
          connectionStore.getConnectionWithCredentials.bind(connectionStore),
      });

      if (result.success) {
        // Mark as successful
        await db
          .update(schema.deliveryLogs)
          .set({
            status: "success",
            externalId: result.externalId,
            errorMessage: undefined,
            nextRetryAt: undefined,
          })
          .where(eq(schema.deliveryLogs.id, job.logId));

        // Emit success signal
        await signalService.broadcast(INTEGRATION_DELIVERY_COMPLETED, {
          logId: job.logId,
          subscriptionId: job.subscriptionId,
          eventType: job.eventId,
          status: "success",
          externalId: result.externalId,
        });

        logger.debug(
          `Delivery successful: ${job.logId} -> ${
            result.externalId ?? "no external ID"
          }`
        );
      } else {
        throw new Error(
          result.error ?? "Delivery failed without error message"
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Get current attempt count
      const [log] = await db
        .select({ attempts: schema.deliveryLogs.attempts })
        .from(schema.deliveryLogs)
        .where(eq(schema.deliveryLogs.id, job.logId));

      const attempts = log?.attempts ?? 1;

      if (attempts < MAX_RETRIES) {
        // Schedule retry
        const retryDelay =
          RETRY_DELAYS.at(attempts - 1) ??
          RETRY_DELAYS.at(-1) ??
          RETRY_DELAYS[0];
        const nextRetryAt = new Date(Date.now() + retryDelay);

        await db
          .update(schema.deliveryLogs)
          .set({
            status: "retrying",
            errorMessage,
            nextRetryAt,
          })
          .where(eq(schema.deliveryLogs.id, job.logId));

        // Re-queue with delay
        const queue = await queueManager.getQueue<DeliveryJobData>(QUEUE_NAME);
        await queue.enqueue(job, { startDelay: retryDelay / 1000 }); // Convert ms to seconds

        logger.warn(
          `Delivery failed (attempt ${attempts}/${MAX_RETRIES}), retrying at ${nextRetryAt.toISOString()}: ${errorMessage}`
        );
      } else {
        // Max retries exceeded, mark as failed
        await db
          .update(schema.deliveryLogs)
          .set({
            status: "failed",
            errorMessage,
            nextRetryAt: undefined,
          })
          .where(eq(schema.deliveryLogs.id, job.logId));

        // Emit failure signal
        await signalService.broadcast(INTEGRATION_DELIVERY_COMPLETED, {
          logId: job.logId,
          subscriptionId: job.subscriptionId,
          eventType: job.eventId,
          status: "failed",
          errorMessage,
        });

        logger.error(
          `Delivery failed permanently after ${MAX_RETRIES} attempts: ${errorMessage}`
        );
      }
    }
  }

  return {
    async routeEvent(event: IntegrationEventPayload): Promise<void> {
      const { eventId, payload, timestamp } = event;

      logger.debug(`Routing integration event: ${eventId}`);

      // Find matching subscriptions
      const subscriptions = await findMatchingSubscriptions(eventId, payload);

      if (subscriptions.length === 0) {
        logger.debug(`No matching subscriptions for event: ${eventId}`);
        return;
      }

      logger.debug(
        `Found ${subscriptions.length} matching subscriptions for event: ${eventId}`
      );

      // Create delivery log entries and queue jobs
      const queue = await queueManager.getQueue<DeliveryJobData>(QUEUE_NAME);

      for (const subscription of subscriptions) {
        const logId = crypto.randomUUID();

        // Create delivery log entry
        await db.insert(schema.deliveryLogs).values({
          id: logId,
          subscriptionId: subscription.id,
          eventType: eventId,
          eventPayload: payload,
          status: "pending",
          attempts: 0,
        });

        // Queue delivery job
        const jobData: DeliveryJobData = {
          logId,
          subscriptionId: subscription.id,
          subscriptionName: subscription.name,
          providerId: subscription.providerId,
          providerConfig: subscription.providerConfig,
          eventId,
          payload,
          timestamp,
        };

        await queue.enqueue(jobData);

        logger.debug(
          `Queued delivery: ${logId} for subscription: ${subscription.name}`
        );
      }
    },

    async startWorker(): Promise<void> {
      const queue = await queueManager.getQueue<DeliveryJobData>(QUEUE_NAME);

      await queue.consume(
        async (job) => {
          await executeDelivery(job.data);
        },
        { consumerGroup: "integration-delivery" }
      );

      logger.info(
        `Integration delivery worker started on queue: ${QUEUE_NAME}`
      );
    },

    async retryDelivery(
      logId: string
    ): Promise<{ success: boolean; message?: string }> {
      // Get the delivery log
      const [log] = await db
        .select()
        .from(schema.deliveryLogs)
        .where(eq(schema.deliveryLogs.id, logId));

      if (!log) {
        return { success: false, message: "Delivery log not found" };
      }

      if (log.status !== "failed") {
        return { success: false, message: "Can only retry failed deliveries" };
      }

      // Get the subscription
      const [subscription] = await db
        .select()
        .from(schema.webhookSubscriptions)
        .where(eq(schema.webhookSubscriptions.id, log.subscriptionId));

      if (!subscription) {
        return { success: false, message: "Subscription not found" };
      }

      // Reset the log and re-queue
      await db
        .update(schema.deliveryLogs)
        .set({
          status: "pending",
          attempts: 0,
          errorMessage: undefined,
          nextRetryAt: undefined,
        })
        .where(eq(schema.deliveryLogs.id, logId));

      // Queue delivery job
      const jobData: DeliveryJobData = {
        logId,
        subscriptionId: subscription.id,
        subscriptionName: subscription.name,
        providerId: subscription.providerId,
        providerConfig: subscription.providerConfig,
        eventId: log.eventType,
        payload: log.eventPayload,
        timestamp: new Date().toISOString(),
      };

      const queue = await queueManager.getQueue<DeliveryJobData>(QUEUE_NAME);
      await queue.enqueue(jobData);

      return { success: true, message: "Delivery re-queued" };
    },
  };
}
