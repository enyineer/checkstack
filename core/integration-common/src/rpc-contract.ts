import { z } from "zod";
import { integrationAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  createClientDefinition,
  proc,
} from "@checkstack/common";
import {
  IntegrationProviderInfoSchema,
  TestConnectionResultSchema,
  ProviderConnectionRedactedSchema,
  CreateConnectionInputSchema,
  UpdateConnectionInputSchema,
  GetConnectionOptionsInputSchema,
  ConnectionOptionSchema,
} from "./schemas";

/**
 * Integration RPC contract — scoped to connection management.
 *
 * The legacy subscription + delivery-log + event-listing endpoints
 * moved to the Automation Platform; existing subscriptions are
 * auto-migrated on boot (see `@checkstack/automation-backend`'s
 * migration module). All remaining endpoints relate to the connection
 * store, which the Automation editor uses to pick a connection for
 * provider-bound actions.
 */
export const integrationContract = {
  // ==========================================================================
  // PROVIDER DISCOVERY (Admin only)
  // ==========================================================================

  /** List all registered integration providers (connection-capable plugins) */
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
    .route({ method: "PATCH" })
    .input(UpdateConnectionInputSchema)
    .output(ProviderConnectionRedactedSchema),

  /** Delete a provider connection */
  deleteConnection: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [integrationAccess.manage],
  })
    .route({ method: "DELETE" })
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
  // ONE-TIME MIGRATION SUPPORT (service-to-service)
  //
  // Exposed so `@checkstack/automation-backend` can read the legacy
  // `webhook_subscriptions` rows during boot and translate them into
  // automations. Plugins are sandboxed to their own schema, so this is
  // the only way to reach the legacy table from another plugin.
  // Once the legacy table is dropped in a follow-up release these
  // endpoints will be removed.
  // ==========================================================================

  listLegacySubscriptions: proc({
    operationType: "query",
    userType: "service",
    access: [],
  }).output(
    z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        providerId: z.string(),
        providerConfig: z.record(z.string(), z.unknown()),
        eventId: z.string(),
        systemFilter: z.array(z.string()).optional(),
        enabled: z.boolean(),
      }),
    ),
  ),
};

export type IntegrationContract = typeof integrationContract;

export const IntegrationApi = createClientDefinition(
  integrationContract,
  pluginMetadata,
);
