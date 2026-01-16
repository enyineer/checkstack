import { z } from "zod";
import { integrationAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import { createClientDefinition, proc } from "@checkstack/common";
import {
  WebhookSubscriptionSchema,
  CreateSubscriptionInputSchema,
  UpdateSubscriptionInputSchema,
  DeliveryLogSchema,
  DeliveryLogQueryInputSchema,
  IntegrationProviderInfoSchema,
  IntegrationEventInfoSchema,
  TestConnectionResultSchema,
  ProviderConnectionRedactedSchema,
  CreateConnectionInputSchema,
  UpdateConnectionInputSchema,
  GetConnectionOptionsInputSchema,
  ConnectionOptionSchema,
  EventPayloadSchemaOutputSchema,
} from "./schemas";

// Integration RPC Contract
export const integrationContract = {
  // ==========================================================================
  // SUBSCRIPTION MANAGEMENT (Admin only)
  // ==========================================================================

  /** List all webhook subscriptions */
  listSubscriptions: proc({
    operationType: "query",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
        providerId: z.string().optional(),
        eventType: z.string().optional(),
        enabled: z.boolean().optional(),
      })
    )
    .output(
      z.object({
        subscriptions: z.array(WebhookSubscriptionSchema),
        total: z.number(),
      })
    ),

  /** Get a single subscription by ID */
  getSubscription: proc({
    operationType: "query",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(z.object({ id: z.string() }))
    .output(WebhookSubscriptionSchema),

  /** Create a new webhook subscription */
  createSubscription: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(CreateSubscriptionInputSchema)
    .output(WebhookSubscriptionSchema),

  /** Update an existing subscription */
  updateSubscription: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(UpdateSubscriptionInputSchema)
    .output(WebhookSubscriptionSchema),

  /** Delete a subscription */
  deleteSubscription: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Toggle subscription enabled state */
  toggleSubscription: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // PROVIDER DISCOVERY (Admin only)
  // ==========================================================================

  /** List all registered integration providers */
  listProviders: proc({
    operationType: "query",
    userType: "authenticated",
    access: [integrationAccess.manage],
  }).output(z.array(IntegrationProviderInfoSchema)),

  /** Test a provider connection with given config */
  testProviderConnection: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(
      z.object({
        providerId: z.string(),
        config: z.record(z.string(), z.unknown()),
      })
    )
    .output(TestConnectionResultSchema),

  // ==========================================================================
  // CONNECTION MANAGEMENT (Admin only)
  // Generic CRUD for site-wide provider connections
  // ==========================================================================

  /** List all connections for a provider */
  listConnections: proc({
    operationType: "query",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(z.object({ providerId: z.string() }))
    .output(z.array(ProviderConnectionRedactedSchema)),

  /** Get a single connection (redacted) */
  getConnection: proc({
    operationType: "query",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(z.object({ connectionId: z.string() }))
    .output(ProviderConnectionRedactedSchema),

  /** Create a new provider connection */
  createConnection: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(CreateConnectionInputSchema)
    .output(ProviderConnectionRedactedSchema),

  /** Update a provider connection */
  updateConnection: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(UpdateConnectionInputSchema)
    .output(ProviderConnectionRedactedSchema),

  /** Delete a provider connection */
  deleteConnection: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(z.object({ connectionId: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Test a saved connection */
  testConnection: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(z.object({ connectionId: z.string() }))
    .output(TestConnectionResultSchema),

  /** Get dynamic options for cascading dropdowns */
  getConnectionOptions: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(GetConnectionOptionsInputSchema)
    .output(z.array(ConnectionOptionSchema)),

  // ==========================================================================
  // EVENT DISCOVERY (Admin only)
  // ==========================================================================

  /** List all registered integration events */
  listEventTypes: proc({
    operationType: "query",
    userType: "authenticated",
    access: [integrationAccess.manage],
  }).output(z.array(IntegrationEventInfoSchema)),

  /** Get events grouped by category */
  getEventsByCategory: proc({
    operationType: "query",
    userType: "authenticated",
    access: [integrationAccess.manage],
  }).output(
    z.array(
      z.object({
        category: z.string(),
        events: z.array(IntegrationEventInfoSchema),
      })
    )
  ),

  /** Get payload schema for a specific event with flattened property list for template hints */
  getEventPayloadSchema: proc({
    operationType: "query",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(z.object({ eventId: z.string() }))
    .output(EventPayloadSchemaOutputSchema),

  // ==========================================================================
  // DELIVERY LOGS (Admin only)
  // ==========================================================================

  /** Get delivery logs with filtering */
  getDeliveryLogs: proc({
    operationType: "query",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(DeliveryLogQueryInputSchema)
    .output(
      z.object({
        logs: z.array(DeliveryLogSchema),
        total: z.number(),
      })
    ),

  /** Get a single delivery log entry */
  getDeliveryLog: proc({
    operationType: "query",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(z.object({ id: z.string() }))
    .output(DeliveryLogSchema),

  /** Retry a failed delivery */
  retryDelivery: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(z.object({ logId: z.string() }))
    .output(z.object({ success: z.boolean(), message: z.string().optional() })),

  /** Get delivery statistics for dashboard */
  getDeliveryStats: proc({
    operationType: "query",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .input(
      z.object({
        /** Time range in hours (default: 24) */
        hours: z.number().min(1).max(720).default(24),
      })
    )
    .output(
      z.object({
        total: z.number(),
        successful: z.number(),
        failed: z.number(),
        retrying: z.number(),
        pending: z.number(),
        byEvent: z.array(
          z.object({
            eventType: z.string(),
            count: z.number(),
          })
        ),
        byProvider: z.array(
          z.object({
            providerId: z.string(),
            count: z.number(),
          })
        ),
      })
    ),
};

// Export contract type
export type IntegrationContract = typeof integrationContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(IntegrationApi);
export const IntegrationApi = createClientDefinition(
  integrationContract,
  pluginMetadata
);
