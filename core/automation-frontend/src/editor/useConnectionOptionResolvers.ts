import React from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { IntegrationApi } from "@checkstack/integration-common";
import type { OptionsResolver } from "@checkstack/ui";

/**
 * Resolver name for the connection picker itself. Mirrors the
 * `CONNECTION_OPTIONS` constant every integration provider defines
 * (`provider.ts` → `*_RESOLVERS.CONNECTION_OPTIONS`). The bridge resolves
 * this one via `listConnectionSummaries` (no connection is selected yet) and
 * every other resolver name via `resolveConnectionOptions` (cascading dropdowns
 * that depend on the chosen `connectionId`).
 */
const CONNECTION_RESOLVER_NAME = "connectionOptions";

/**
 * Bridges a connection-backed action's `x-options-resolver` schema fields to
 * the integration RPC contract so the automation editor's `DynamicForm` can
 * render a working connection picker plus cascading provider dropdowns.
 *
 * Returns a stable, name-agnostic resolver map: the `connectionOptions`
 * resolver lists the provider's connections, and any other resolver name is
 * forwarded to `resolveConnectionOptions` for the currently selected
 * connection, passing the live form values as `context` for dependent fields.
 *
 * Both calls are the USER-CALLABLE integration endpoints (`listConnectionSummaries`
 * + `resolveConnectionOptions`), NOT the admin-gated `listConnections` /
 * `getConnectionOptions`: an automation author needs working dropdowns without
 * holding `integration.manage`. They return labels/ids only (no config/secrets).
 *
 * When `connectionProviderId` is undefined (a non-connection action such as
 * Log or Run Script), an empty map is returned so nothing tries to resolve.
 */
export function useConnectionOptionResolvers(
  connectionProviderId?: string,
): Record<string, OptionsResolver> {
  const client = usePluginClient(IntegrationApi);

  return React.useMemo(() => {
    if (!connectionProviderId) return {};
    const providerId = connectionProviderId;

    // A Proxy lets us serve a resolver for any resolver name a provider's
    // schema references without enumerating them here; the field component
    // only ever reads `optionsResolvers[resolverName]`.
    const handler: ProxyHandler<Record<string, OptionsResolver>> = {
      get: (_target, prop) => {
        if (typeof prop !== "string") return;
        const resolverName = prop;

        const resolver: OptionsResolver = async (formValues) => {
          if (resolverName === CONNECTION_RESOLVER_NAME) {
            const connections = await client.listConnectionSummaries.call({
              providerId,
            });
            return connections.map((connection) => ({
              value: connection.id,
              label: connection.name,
            }));
          }

          const connectionId = formValues.connectionId;
          if (typeof connectionId !== "string" || connectionId.length === 0) {
            return [];
          }

          const options = await client.resolveConnectionOptions.call({
            providerId,
            connectionId,
            resolverName,
            context: formValues,
          });
          return options.map((option) => ({
            value: option.value,
            label: option.label,
          }));
        };

        return resolver;
      },
    };

    return new Proxy<Record<string, OptionsResolver>>({}, handler);
  }, [client, connectionProviderId]);
}
