import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type Logger,
  type RpcContext,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import { maskSecrets } from "@checkstack/secrets-common";
import { integrationContract } from "@checkstack/integration-common";

import type { IntegrationProviderRegistry } from "./provider-registry";
import type { ConnectionStore } from "./connection-store";
import { buildConfigValidationErrorData } from "./connection-validation-error";
import * as schema from "./schema";

interface RouterDeps {
  db: SafeDatabase<typeof schema>;
  providerRegistry: IntegrationProviderRegistry;
  connectionStore: ConnectionStore;
  logger: Logger;
}

/**
 * Integration router — connection management only. The legacy
 * subscription / event-listing / delivery-log endpoints were removed
 * when the platform moved to the Automation Platform model.
 */
export function createIntegrationRouter(deps: RouterDeps) {
  const { db, providerRegistry, connectionStore, logger } = deps;

  const os = implement(integrationContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    // ─── Providers ───────────────────────────────────────────────────────

    listProviders: os.listProviders.handler(async () => {
      const providers = providerRegistry.getProviders();
      return providers.map((p) => ({
        qualifiedId: p.qualifiedId,
        displayName: p.displayName,
        description: p.description,
        icon: p.icon,
        ownerPluginId: p.ownerPluginId,
        // Legacy `supportedEvents` is no longer modelled on providers
        // (the trigger registry owns event metadata now). Return empty
        // so the wire schema stays stable.
        supportedEvents: [],
        // Legacy `configSchema` was the per-subscription config; that
        // lives on action definitions now. Returning an empty object
        // preserves the wire shape until the schema is bumped.
        configSchema: {},
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
          // Mask any credential the submitted config carries out of the
          // provider error before returning (same guard as the saved-
          // connection testConnection path below).
          const values: string[] = [];
          collectStringLeaves(config, values);
          return {
            success: false,
            message: maskSecrets({
              text: extractErrorMessage(error),
              values,
            }),
          };
        }
      },
    ),

    // ─── Connections ─────────────────────────────────────────────────────

    listConnections: os.listConnections.handler(async ({ input }) => {
      const { providerId } = input;

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

      const parseResult = provider.connectionSchema.safeValidate(config);
      if (!parseResult.success) {
        // Attach the structured zod issues (field path + message) on the
        // error `data` so the frontend can surface each failure INLINE on the
        // offending connection field. The `code` discriminator lets the
        // client distinguish this from any other structured error payload.
        throw new ORPCError("BAD_REQUEST", {
          message: `Invalid connection config: ${parseResult.error.message}`,
          data: buildConfigValidationErrorData(parseResult.error),
        });
      }

      // `connectionSchema` is `Versioned<unknown>` once the provider leaves
      // the registry (the per-provider `TConnection` generic is erased), so
      // `safeValidate` yields `unknown`. The connection store stores configs
      // as `Record<string, unknown>`; this validated value is the provider's
      // own object config, so the narrowing cast is safe.
      const validatedConfig = parseResult.data as Record<string, unknown>;

      const connection = await connectionStore.createConnection({
        providerId,
        name,
        config: validatedConfig,
      });

      logger.info(`Created connection "${name}" for provider ${providerId}`);

      // Return the REDACTED preview (secret fields stripped) rather than
      // echoing the raw submitted config back — credentials must never
      // cross back to the browser, even on create.
      const redacted = await connectionStore.getConnection(connection.id);
      return {
        id: connection.id,
        providerId: connection.providerId,
        name: connection.name,
        configPreview: redacted?.configPreview ?? {},
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

        // Return the REDACTED preview rather than echoing the submitted
        // config — credentials must never cross back to the browser.
        const redacted = await connectionStore.getConnection(connection.id);
        return {
          id: connection.id,
          providerId: connection.providerId,
          name: connection.name,
          configPreview: redacted?.configPreview ?? {},
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        };
      } catch (error) {
        throw new ORPCError("NOT_FOUND", {
          message: extractErrorMessage(error, "Connection not found"),
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
        connectionId,
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
        // The resolved connection config carries live credentials. A
        // provider error may echo a token (e.g. "401 with Bearer <token>").
        // There is no run-scoped secret registry on this path, so build a
        // per-call mask set from the resolved config's string leaves and
        // run the error through it before returning to the browser.
        const values: string[] = [];
        collectStringLeaves(connection.config, values);
        return {
          success: false,
          message: maskSecrets({
            text: extractErrorMessage(error),
            values,
          }),
        };
      }
    }),

    // ─── One-time migration support ──────────────────────────────────────

    listLegacySubscriptions: os.listLegacySubscriptions.handler(async () => {
      const rows = await db.select().from(schema.webhookSubscriptions);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        providerId: row.providerId,
        providerConfig: row.providerConfig,
        eventId: row.eventId,
        systemFilter: row.systemFilter ?? undefined,
        enabled: row.enabled,
      }));
    }),

    getConnectionOptions: os.getConnectionOptions.handler(async ({ input }) => {
      const { providerId, connectionId, resolverName, context } = input;

      logger.debug(
        `getConnectionOptions called: providerId=${providerId}, connectionId=${connectionId}, resolverName=${resolverName}`,
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
          `getConnectionOptions returned ${options.length} options for ${resolverName}`,
        );
        return options;
      } catch (error) {
        logger.error(`Failed to get connection options: ${error}`);
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: extractErrorMessage(error, "Failed to fetch options"),
        });
      }
    }),
  });
}

export type IntegrationRouter = ReturnType<typeof createIntegrationRouter>;

/**
 * Collect every string leaf in a JSON-like value into `out`. Used to build
 * a per-call secret mask set from a resolved/submitted connection config so
 * a provider error echoing a credential can be redacted before it crosses
 * back to the browser. Mirrors the dispatch engine's run-secret capture.
 */
function collectStringLeaves(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStringLeaves(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectStringLeaves(v, out);
  }
}
