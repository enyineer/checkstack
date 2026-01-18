import { implement, ORPCError } from "@orpc/server";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  autoAuthMiddleware,
  type RpcContext,
  type Logger,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import { eq, desc, and, gte, count } from "drizzle-orm";

import type { IntegrationEventRegistry } from "./event-registry";
import type { IntegrationProviderRegistry } from "./provider-registry";
import type { DeliveryCoordinator } from "./delivery-coordinator";
import type { ConnectionStore } from "./connection-store";
import * as schema from "./schema";
import {
  integrationContract,
  INTEGRATION_SUBSCRIPTION_CHANGED,
} from "@checkstack/integration-common";

/**
 * Recursively extracts flattened property paths from a JSON Schema.
 * Used to provide template hints for payload properties.
 */
interface JsonSchemaProperty {
  path: string;
  type: string;
  description?: string;
}

function extractJsonSchemaProperties(
  schema: Record<string, unknown>,
  basePath: string = ""
): JsonSchemaProperty[] {
  const properties: JsonSchemaProperty[] = [];

  const schemaType = schema["type"] as string | string[] | undefined;
  const schemaProperties = schema["properties"] as
    | Record<string, Record<string, unknown>>
    | undefined;
  const schemaItems = schema["items"] as Record<string, unknown> | undefined;
  const schemaDescription = schema["description"] as string | undefined;

  // Handle object with properties
  if (schemaProperties) {
    for (const [key, propSchema] of Object.entries(schemaProperties)) {
      const propPath = basePath ? `${basePath}.${key}` : key;
      const propType = (propSchema["type"] as string) || "unknown";
      const propDescription = propSchema["description"] as string | undefined;

      // Add this property
      properties.push({
        path: propPath,
        type: Array.isArray(propType) ? propType.join(" | ") : propType,
        description: propDescription,
      });

      // Recurse into nested objects
      if (propType === "object" || propSchema["properties"]) {
        properties.push(...extractJsonSchemaProperties(propSchema, propPath));
      }

      // Recurse into arrays (add [n] notation)
      if (propType === "array" && propSchema["items"]) {
        const itemsSchema = propSchema["items"] as Record<string, unknown>;
        properties.push(
          ...extractJsonSchemaProperties(itemsSchema, `${propPath}[n]`)
        );
      }
    }
  }

  // Handle array at root level
  if (schemaType === "array" && schemaItems) {
    properties.push(
      ...extractJsonSchemaProperties(schemaItems, `${basePath}[n]`)
    );
  }

  // If this is a primitive with a path, add it
  if (
    basePath &&
    schemaType &&
    schemaType !== "object" &&
    schemaType !== "array" &&
    !schemaProperties
  ) {
    properties.push({
      path: basePath,
      type: Array.isArray(schemaType) ? schemaType.join(" | ") : schemaType,
      description: schemaDescription,
    });
  }

  return properties;
}

interface RouterDeps {
  db: SafeDatabase<typeof schema>;
  eventRegistry: IntegrationEventRegistry;
  providerRegistry: IntegrationProviderRegistry;
  deliveryCoordinator: DeliveryCoordinator;
  connectionStore: ConnectionStore;
  signalService: SignalService;
  logger: Logger;
}

/**
 * Creates the integration router using contract-based implementation.
 *
 * Auth and access rules are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.access.
 */
export function createIntegrationRouter(deps: RouterDeps) {
  const {
    db,
    eventRegistry,
    providerRegistry,
    deliveryCoordinator,
    connectionStore,
    signalService,
    logger,
  } = deps;

  // Create contract implementer with context type AND auto auth middleware
  const os = implement(integrationContract)
    .$context<RpcContext>()
    .use(autoAuthMiddleware);

  return os.router({
    // =========================================================================
    // SUBSCRIPTION MANAGEMENT
    // =========================================================================

    listSubscriptions: os.listSubscriptions.handler(async ({ input }) => {
      const { page, pageSize, providerId, eventType, enabled } = input;
      const offset = (page - 1) * pageSize;

      // Build where conditions
      const conditions = [];
      if (providerId) {
        conditions.push(eq(schema.webhookSubscriptions.providerId, providerId));
      }
      if (enabled !== undefined) {
        conditions.push(eq(schema.webhookSubscriptions.enabled, enabled));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const [{ value: total }] = await db
        .select({ value: count() })
        .from(schema.webhookSubscriptions)
        .where(whereClause);

      // Get paginated results
      let query = db
        .select()
        .from(schema.webhookSubscriptions)
        .orderBy(desc(schema.webhookSubscriptions.createdAt))
        .limit(pageSize)
        .offset(offset);

      if (whereClause) {
        query = query.where(whereClause) as typeof query;
      }

      const subscriptions = await query;

      // Filter by event type if specified
      const filtered = eventType
        ? subscriptions.filter((s) => s.eventId === eventType)
        : subscriptions;

      return {
        subscriptions: filtered.map((s) => ({
          ...s,
          description: s.description ?? undefined,
          systemFilter: s.systemFilter ?? undefined,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        total: Number(total),
      };
    }),

    getSubscription: os.getSubscription.handler(async ({ input }) => {
      const [subscription] = await db
        .select()
        .from(schema.webhookSubscriptions)
        .where(eq(schema.webhookSubscriptions.id, input.id));

      if (!subscription) {
        throw new ORPCError("NOT_FOUND", {
          message: "Subscription not found",
        });
      }

      return {
        ...subscription,
        description: subscription.description ?? undefined,
        systemFilter: subscription.systemFilter ?? undefined,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      };
    }),

    createSubscription: os.createSubscription.handler(async ({ input }) => {
      const {
        name,
        description,
        providerId,
        providerConfig,
        eventId,
        systemFilter,
      } = input;

      // Validate provider exists
      const provider = providerRegistry.getProvider(providerId);
      if (!provider) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Provider not found: ${providerId}`,
        });
      }

      // Validate event exists
      if (!eventRegistry.hasEvent(eventId)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Event type not found: ${eventId}`,
        });
      }

      // Validate providerConfig against the provider's schema
      const configParseResult =
        provider.config.schema.safeParse(providerConfig);
      if (!configParseResult.success) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Invalid provider configuration: ${configParseResult.error.message}`,
        });
      }

      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(schema.webhookSubscriptions).values({
        id,
        name,
        description,
        providerId,
        providerConfig,
        eventId,
        systemFilter,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });

      // Emit signal
      await signalService.broadcast(INTEGRATION_SUBSCRIPTION_CHANGED, {
        action: "created",
        subscriptionId: id,
      });

      logger.info(`Created webhook subscription: ${name} (${id})`);

      return {
        id,
        name,
        description,
        providerId,
        providerConfig,
        eventId,
        systemFilter,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
    }),

    updateSubscription: os.updateSubscription.handler(async ({ input }) => {
      const { id, updates } = input;

      // Check subscription exists
      const [existing] = await db
        .select()
        .from(schema.webhookSubscriptions)
        .where(eq(schema.webhookSubscriptions.id, id));

      if (!existing) {
        throw new ORPCError("NOT_FOUND", {
          message: "Subscription not found",
        });
      }

      // Validate event if updated
      if (updates.eventId && !eventRegistry.hasEvent(updates.eventId)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Event type not found: ${updates.eventId}`,
        });
      }

      // Validate providerConfig if updated
      if (updates.providerConfig) {
        const provider = providerRegistry.getProvider(existing.providerId);
        if (provider) {
          const configParseResult = provider.config.schema.safeParse(
            updates.providerConfig
          );
          if (!configParseResult.success) {
            throw new ORPCError("BAD_REQUEST", {
              message: `Invalid provider configuration: ${configParseResult.error.message}`,
            });
          }
        }
      }

      const now = new Date();

      await db
        .update(schema.webhookSubscriptions)
        .set({
          ...updates,
          updatedAt: now,
        })
        .where(eq(schema.webhookSubscriptions.id, id));

      // Emit signal
      await signalService.broadcast(INTEGRATION_SUBSCRIPTION_CHANGED, {
        action: "updated",
        subscriptionId: id,
      });

      // Re-fetch updated subscription
      const [updated] = await db
        .select()
        .from(schema.webhookSubscriptions)
        .where(eq(schema.webhookSubscriptions.id, id));

      return {
        ...updated,
        description: updated.description ?? undefined,
        systemFilter: updated.systemFilter ?? undefined,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    }),

    deleteSubscription: os.deleteSubscription.handler(async ({ input }) => {
      const { id } = input;

      await db
        .delete(schema.webhookSubscriptions)
        .where(eq(schema.webhookSubscriptions.id, id));

      // Emit signal
      await signalService.broadcast(INTEGRATION_SUBSCRIPTION_CHANGED, {
        action: "deleted",
        subscriptionId: id,
      });

      logger.info(`Deleted webhook subscription: ${id}`);

      return { success: true };
    }),

    toggleSubscription: os.toggleSubscription.handler(async ({ input }) => {
      const { id, enabled } = input;

      await db
        .update(schema.webhookSubscriptions)
        .set({
          enabled,
          updatedAt: new Date(),
        })
        .where(eq(schema.webhookSubscriptions.id, id));

      // Emit signal
      await signalService.broadcast(INTEGRATION_SUBSCRIPTION_CHANGED, {
        action: "updated",
        subscriptionId: id,
      });

      return { success: true };
    }),

    // =========================================================================
    // PROVIDER DISCOVERY
    // =========================================================================

    listProviders: os.listProviders.handler(async () => {
      const providers = providerRegistry.getProviders();

      return providers.map((p) => ({
        qualifiedId: p.qualifiedId,
        displayName: p.displayName,
        description: p.description,
        icon: p.icon,
        ownerPluginId: p.ownerPluginId,
        supportedEvents: p.supportedEvents,
        configSchema:
          providerRegistry.getProviderConfigSchema(p.qualifiedId) ?? {},
        hasConnectionSchema: !!p.connectionSchema,
        connectionSchema: p.connectionSchema
          ? providerRegistry.getProviderConnectionSchema(p.qualifiedId)
          : undefined,
        documentation: p.documentation,
      }));
    }),

    testProviderConnection: os.testProviderConnection.handler(
      async ({ input }) => {
        const { providerId, config } = input;

        const provider = providerRegistry.getProvider(providerId);
        if (!provider) {
          return { success: false, message: "Provider not found" };
        }

        if (!provider.testConnection) {
          return {
            success: true,
            message: "Provider does not support connection testing",
          };
        }

        try {
          const result = await provider.testConnection(config);
          return result;
        } catch (error) {
          return {
            success: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }
    ),

    // =========================================================================
    // CONNECTION MANAGEMENT
    // Generic CRUD for site-wide provider connections
    // =========================================================================

    listConnections: os.listConnections.handler(async ({ input }) => {
      const { providerId } = input;

      // Verify provider exists and has connectionSchema
      const provider = providerRegistry.getProvider(providerId);
      if (!provider) {
        throw new ORPCError("NOT_FOUND", {
          message: `Provider not found: ${providerId}`,
        });
      }

      if (!provider.connectionSchema) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Provider ${providerId} does not support site-wide connections`,
        });
      }

      return connectionStore.listConnections(providerId);
    }),

    getConnection: os.getConnection.handler(async ({ input }) => {
      const { connectionId } = input;
      const connection = await connectionStore.getConnection(connectionId);

      if (!connection) {
        throw new ORPCError("NOT_FOUND", {
          message: `Connection not found: ${connectionId}`,
        });
      }

      return connection;
    }),

    createConnection: os.createConnection.handler(async ({ input }) => {
      const { providerId, name, config } = input;

      // Verify provider exists and has connectionSchema
      const provider = providerRegistry.getProvider(providerId);
      if (!provider) {
        throw new ORPCError("NOT_FOUND", {
          message: `Provider not found: ${providerId}`,
        });
      }

      if (!provider.connectionSchema) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Provider ${providerId} does not support site-wide connections`,
        });
      }

      // Validate config against provider's connectionSchema
      const parseResult = provider.connectionSchema.schema.safeParse(config);
      if (!parseResult.success) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Invalid connection config: ${parseResult.error.message}`,
        });
      }

      // parseResult.data is typed correctly after guard
      const validatedConfig = parseResult.data as unknown as Record<
        string,
        unknown
      >;

      const connection = await connectionStore.createConnection({
        providerId,
        name,
        config: validatedConfig,
      });

      logger.info(`Created connection "${name}" for provider ${providerId}`);

      // Return redacted version
      return {
        id: connection.id,
        providerId: connection.providerId,
        name: connection.name,
        configPreview: config, // Will be redacted in real usage
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      };
    }),

    updateConnection: os.updateConnection.handler(async ({ input }) => {
      const { connectionId, updates } = input;

      try {
        const connection = await connectionStore.updateConnection({
          connectionId,
          updates,
        });

        return {
          id: connection.id,
          providerId: connection.providerId,
          name: connection.name,
          configPreview: (updates.config ?? {}) as Record<string, unknown>,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        };
      } catch (error) {
        throw new ORPCError("NOT_FOUND", {
          message:
            error instanceof Error ? error.message : "Connection not found",
        });
      }
    }),

    deleteConnection: os.deleteConnection.handler(async ({ input }) => {
      const { connectionId } = input;
      const deleted = await connectionStore.deleteConnection(connectionId);

      if (!deleted) {
        throw new ORPCError("NOT_FOUND", {
          message: `Connection not found: ${connectionId}`,
        });
      }

      return { success: true };
    }),

    testConnection: os.testConnection.handler(async ({ input }) => {
      const { connectionId } = input;

      const connection = await connectionStore.getConnectionWithCredentials(
        connectionId
      );
      if (!connection) {
        return { success: false, message: "Connection not found" };
      }

      const provider = providerRegistry.getProvider(connection.providerId);
      if (!provider) {
        return { success: false, message: "Provider not found" };
      }

      if (!provider.testConnection) {
        return {
          success: true,
          message: "Provider does not support connection testing",
        };
      }

      try {
        const result = await provider.testConnection(connection.config);
        return result;
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }),

    getConnectionOptions: os.getConnectionOptions.handler(async ({ input }) => {
      const { providerId, connectionId, resolverName, context } = input;

      logger.debug(
        `getConnectionOptions called: providerId=${providerId}, connectionId=${connectionId}, resolverName=${resolverName}`
      );

      const provider = providerRegistry.getProvider(providerId);
      if (!provider) {
        throw new ORPCError("NOT_FOUND", {
          message: `Provider not found: ${providerId}`,
        });
      }

      if (!provider.getConnectionOptions) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Provider ${providerId} does not support dynamic options`,
        });
      }

      try {
        const options = await provider.getConnectionOptions({
          connectionId,
          resolverName,
          context,
          logger,
          getConnectionWithCredentials:
            connectionStore.getConnectionWithCredentials.bind(connectionStore),
        });
        logger.debug(
          `getConnectionOptions returned ${options.length} options for ${resolverName}`
        );
        return options;
      } catch (error) {
        logger.error(`Failed to get connection options: ${error}`);
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message:
            error instanceof Error ? error.message : "Failed to fetch options",
        });
      }
    }),

    // =========================================================================
    // EVENT DISCOVERY
    // =========================================================================

    listEventTypes: os.listEventTypes.handler(async () => {
      const events = eventRegistry.getEvents();

      return events.map((e) => ({
        eventId: e.eventId,
        displayName: e.displayName,
        description: e.description,
        category: e.category,
        ownerPluginId: e.ownerPluginId,
        payloadSchema: e.payloadJsonSchema,
      }));
    }),

    getEventsByCategory: os.getEventsByCategory.handler(async () => {
      const byCategory = eventRegistry.getEventsByCategory();

      return [...byCategory.entries()].map(([category, events]) => ({
        category,
        events: events.map((e) => ({
          eventId: e.eventId,
          displayName: e.displayName,
          description: e.description,
          category: e.category,
          ownerPluginId: e.ownerPluginId,
          payloadSchema: e.payloadJsonSchema,
        })),
      }));
    }),

    getEventPayloadSchema: os.getEventPayloadSchema.handler(
      async ({ input }) => {
        const { eventId } = input;

        const event = eventRegistry.getEvent(eventId);
        if (!event) {
          throw new ORPCError("NOT_FOUND", {
            message: `Event not found: ${eventId}`,
          });
        }

        // Extract flattened properties from JSON Schema
        const availableProperties = extractJsonSchemaProperties(
          event.payloadJsonSchema,
          "payload"
        );

        return {
          eventId: event.eventId,
          payloadSchema: event.payloadJsonSchema,
          availableProperties,
        };
      }
    ),

    // =========================================================================
    // DELIVERY LOGS
    // =========================================================================

    getDeliveryLogs: os.getDeliveryLogs.handler(async ({ input }) => {
      const { subscriptionId, eventType, status, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      // Build where conditions
      const conditions = [];
      if (subscriptionId) {
        conditions.push(eq(schema.deliveryLogs.subscriptionId, subscriptionId));
      }
      if (eventType) {
        conditions.push(eq(schema.deliveryLogs.eventType, eventType));
      }
      if (status) {
        conditions.push(eq(schema.deliveryLogs.status, status));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const [{ value: total }] = await db
        .select({ value: count() })
        .from(schema.deliveryLogs)
        .where(whereClause);

      // Get paginated results with subscription name
      const logs = await db
        .select({
          log: schema.deliveryLogs,
          subscriptionName: schema.webhookSubscriptions.name,
        })
        .from(schema.deliveryLogs)
        .leftJoin(
          schema.webhookSubscriptions,
          eq(schema.deliveryLogs.subscriptionId, schema.webhookSubscriptions.id)
        )
        .where(whereClause)
        .orderBy(desc(schema.deliveryLogs.createdAt))
        .limit(pageSize)
        .offset(offset);

      return {
        logs: logs.map(({ log, subscriptionName }) => ({
          ...log,
          subscriptionName: subscriptionName ?? undefined,
          createdAt: log.createdAt,
          lastAttemptAt: log.lastAttemptAt ?? undefined,
          nextRetryAt: log.nextRetryAt ?? undefined,
          externalId: log.externalId ?? undefined,
          errorMessage: log.errorMessage ?? undefined,
        })),
        total: Number(total),
      };
    }),

    getDeliveryLog: os.getDeliveryLog.handler(async ({ input }) => {
      const [result] = await db
        .select({
          log: schema.deliveryLogs,
          subscriptionName: schema.webhookSubscriptions.name,
        })
        .from(schema.deliveryLogs)
        .leftJoin(
          schema.webhookSubscriptions,
          eq(schema.deliveryLogs.subscriptionId, schema.webhookSubscriptions.id)
        )
        .where(eq(schema.deliveryLogs.id, input.id));

      if (!result) {
        throw new ORPCError("NOT_FOUND", {
          message: "Delivery log not found",
        });
      }

      return {
        ...result.log,
        subscriptionName: result.subscriptionName ?? undefined,
        createdAt: result.log.createdAt,
        lastAttemptAt: result.log.lastAttemptAt ?? undefined,
        nextRetryAt: result.log.nextRetryAt ?? undefined,
        externalId: result.log.externalId ?? undefined,
        errorMessage: result.log.errorMessage ?? undefined,
      };
    }),

    retryDelivery: os.retryDelivery.handler(async ({ input }) => {
      return deliveryCoordinator.retryDelivery(input.logId);
    }),

    getDeliveryStats: os.getDeliveryStats.handler(async ({ input }) => {
      const { hours } = input;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      // Get counts by status
      const statusCounts = await db
        .select({
          status: schema.deliveryLogs.status,
          count: count(),
        })
        .from(schema.deliveryLogs)
        .where(gte(schema.deliveryLogs.createdAt, since))
        .groupBy(schema.deliveryLogs.status);

      // Get counts by event type
      const eventCounts = await db
        .select({
          eventType: schema.deliveryLogs.eventType,
          count: count(),
        })
        .from(schema.deliveryLogs)
        .where(gte(schema.deliveryLogs.createdAt, since))
        .groupBy(schema.deliveryLogs.eventType);

      // Get counts by provider (via subscription)
      const providerCounts = await db
        .select({
          providerId: schema.webhookSubscriptions.providerId,
          count: count(),
        })
        .from(schema.deliveryLogs)
        .innerJoin(
          schema.webhookSubscriptions,
          eq(schema.deliveryLogs.subscriptionId, schema.webhookSubscriptions.id)
        )
        .where(gte(schema.deliveryLogs.createdAt, since))
        .groupBy(schema.webhookSubscriptions.providerId);

      // Build response
      const statusMap = new Map(
        statusCounts.map((s) => [s.status, Number(s.count)])
      );
      const total =
        (statusMap.get("success") ?? 0) +
        (statusMap.get("failed") ?? 0) +
        (statusMap.get("retrying") ?? 0) +
        (statusMap.get("pending") ?? 0);

      return {
        total,
        successful: statusMap.get("success") ?? 0,
        failed: statusMap.get("failed") ?? 0,
        retrying: statusMap.get("retrying") ?? 0,
        pending: statusMap.get("pending") ?? 0,
        byEvent: eventCounts.map((e) => ({
          eventType: e.eventType,
          count: Number(e.count),
        })),
        byProvider: providerCounts.map((p) => ({
          providerId: p.providerId,
          count: Number(p.count),
        })),
      };
    }),
  });
}

export type IntegrationRouter = ReturnType<typeof createIntegrationRouter>;
