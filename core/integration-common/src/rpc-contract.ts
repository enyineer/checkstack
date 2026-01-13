import { oc } from "@orpc/contract";
import { z } from "zod";
import { integrationAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  createClientDefinition,
  type ProcedureMetadata,
} from "@checkstack/common";
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

// Base builder with full metadata support (userType + access)
const _base = oc.$meta<ProcedureMetadata>({});

// Integration RPC Contract
export const integrationContract = {
  // ==========================================================================
  // SUBSCRIPTION MANAGEMENT (Admin only)
  // ==========================================================================

  /** List all webhook subscriptions */
  listSubscriptions: _base
    .meta({
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
  getSubscription: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(z.object({ id: z.string() }))
    .output(WebhookSubscriptionSchema),

  /** Create a new webhook subscription */
  createSubscription: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(CreateSubscriptionInputSchema)
    .output(WebhookSubscriptionSchema),

  /** Update an existing subscription */
  updateSubscription: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(UpdateSubscriptionInputSchema)
    .output(WebhookSubscriptionSchema),

  /** Delete a subscription */
  deleteSubscription: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Toggle subscription enabled state */
  toggleSubscription: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // PROVIDER DISCOVERY (Admin only)
  // ==========================================================================

  /** List all registered integration providers */
  listProviders: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .output(z.array(IntegrationProviderInfoSchema)),

  /** Test a provider connection with given config */
  testProviderConnection: _base
    .meta({
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
  listConnections: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(z.object({ providerId: z.string() }))
    .output(z.array(ProviderConnectionRedactedSchema)),

  /** Get a single connection (redacted) */
  getConnection: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(z.object({ connectionId: z.string() }))
    .output(ProviderConnectionRedactedSchema),

  /** Create a new provider connection */
  createConnection: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(CreateConnectionInputSchema)
    .output(ProviderConnectionRedactedSchema),

  /** Update a provider connection */
  updateConnection: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(UpdateConnectionInputSchema)
    .output(ProviderConnectionRedactedSchema),

  /** Delete a provider connection */
  deleteConnection: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(z.object({ connectionId: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Test a saved connection */
  testConnection: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(z.object({ connectionId: z.string() }))
    .output(TestConnectionResultSchema),

  /** Get dynamic options for cascading dropdowns */
  getConnectionOptions: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(GetConnectionOptionsInputSchema)
    .output(z.array(ConnectionOptionSchema)),

  // ==========================================================================
  // EVENT DISCOVERY (Admin only)
  // ==========================================================================

  /** List all registered integration events */
  listEventTypes: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .output(z.array(IntegrationEventInfoSchema)),

  /** Get events grouped by category */
  getEventsByCategory: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .output(
      z.array(
        z.object({
          category: z.string(),
          events: z.array(IntegrationEventInfoSchema),
        })
      )
    ),

  /** Get payload schema for a specific event with flattened property list for template hints */
  getEventPayloadSchema: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(z.object({ eventId: z.string() }))
    .output(EventPayloadSchemaOutputSchema),

  // ==========================================================================
  // DELIVERY LOGS (Admin only)
  // ==========================================================================

  /** Get delivery logs with filtering */
  getDeliveryLogs: _base
    .meta({
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
  getDeliveryLog: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(z.object({ id: z.string() }))
    .output(DeliveryLogSchema),

  /** Retry a failed delivery */
  retryDelivery: _base
    .meta({
      userType: "authenticated",
      access: [integrationAccess.manage],
    })
    .input(z.object({ logId: z.string() }))
    .output(z.object({ success: z.boolean(), message: z.string().optional() })),

  /** Get delivery statistics for dashboard */
  getDeliveryStats: _base
    .meta({
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
