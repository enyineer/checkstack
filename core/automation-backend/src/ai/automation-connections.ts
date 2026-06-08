import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient } from "@checkstack/backend-api";
import {
  AutomationApi,
  automationAccess,
  pluginMetadata as automationPluginMetadata,
} from "@checkstack/automation-common";
import { IntegrationApi } from "@checkstack/integration-common";
import { z } from "zod";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/**
 * Gated by the automation read rule, identically to the capability tools. The
 * fan-out goes through the USER-SCOPED client passed at call time, so the same
 * access checks a direct UI/RPC call would face apply here too.
 *
 * Connection-capable providers are discovered from the action catalog
 * (`automation.listActions`, gated by the SAME `automation.read` rule this tool
 * holds) via each action's `connectionProviderId` - NOT from the integration
 * plugin's admin-gated `listProviders`. That keeps the tool callable by every
 * automation reader, mirroring the propose-time connection check
 * (`automation-propose-validate.ts`), and degrades gracefully: any FORBIDDEN or
 * transient read collapses to a soft empty result, never a hard tool error.
 */
const AUTOMATION_READ_RULE = qualifyAccessRuleId(
  automationPluginMetadata,
  automationAccess.read,
);

const AutomationListConnectionsInputSchema = z.object({
  /**
   * Optional FULLY-QUALIFIED provider id (`{pluginId}.{providerId}`) to filter
   * to a single provider. Omit to list every connection-capable provider.
   */
  providerId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional filter: the FULLY-QUALIFIED provider id, e.g. "integration-jira.jira" - NOT a short name like "jira" (which matches nothing and looks like "no connections"). It is the action\'s connectionProviderId from automation.getCapabilitySchema. PREFER omitting this and reading all connections from the result.',
    ),
});
type AutomationListConnectionsInput = z.infer<
  typeof AutomationListConnectionsInputSchema
>;

/** One configured connection the model may reference as a `connectionId`. */
const ConnectionEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
});

/** Connections grouped under the provider they belong to. */
const ProviderConnectionsSchema = z.object({
  providerId: z.string(),
  connections: z.array(ConnectionEntrySchema),
});

const AutomationListConnectionsOutputSchema = z.object({
  /** One entry per connection-capable provider (filtered if `providerId` set). */
  providers: z.array(ProviderConnectionsSchema),
  /** Guidance the model must honor when wiring an integration action. */
  note: z.string(),
});
type AutomationListConnectionsOutput = z.infer<
  typeof AutomationListConnectionsOutputSchema
>;

/**
 * `automation.listConnections` - the discovery tool for integration action
 * `connectionId`s. Integration actions (e.g. `jira.create_issue`) take a
 * `config.connectionId` referencing a configured connection; the action
 * resolves credentials at execute time. The model MUST pass one of these REAL
 * ids and NEVER hand-roll a URL or token. `effect: "read"`.
 *
 * Provider discovery comes from the action catalog
 * (`automation.listActions`): the distinct `connectionProviderId` values across
 * all actions are exactly the providers whose actions take a `connectionId`.
 * This source is gated by `automation.read` (the SAME rule this tool holds), so
 * every automation reader can use the tool. An optional `providerId` input
 * narrows the result to one provider.
 *
 * Authorization: gated by the automation read rule; the fan-out goes through
 * the user-scoped client so integration handler authz applies.
 */
export function createAutomationListConnectionsTool(): RegisteredAiTool<
  AutomationListConnectionsInput,
  AutomationListConnectionsOutput
> {
  return {
    name: "automation.listConnections",
    description:
      "List the configured integration connections you can reference as a connectionId in an integration action's config (e.g. jira.create_issue's connectionId). PREFER calling this with NO providerId so you see every provider's connections; only pass providerId to narrow, and then it MUST be the FULLY-QUALIFIED id (e.g. \"integration-jira.jira\"), never a short name like \"jira\" (a short/unknown providerId returns an empty list - do NOT conclude no connections exist; re-call without the filter). ALWAYS use one of these real connectionIds; NEVER hand-roll a URL, token, or credential. Returns connections grouped by provider as { providerId, connections: [{ id, name }] }.",
    effect: "read",
    input: AutomationListConnectionsInputSchema,
    output: AutomationListConnectionsOutputSchema,
    requiredAccessRules: [AUTOMATION_READ_RULE],
    async execute({ input, rpcClient }) {
      const providers = await listProviderConnections({
        rpcClient,
        providerId: input.providerId,
      });
      const total = providers.reduce(
        (sum, entry) => sum + entry.connections.length,
        0,
      );
      return {
        providers,
        note:
          total > 0
            ? "Use one of these connectionIds in the integration action's config. Never hand-roll a URL or token."
            : "No integration connections are configured. Ask an admin to create one before wiring an integration action; never hand-roll a URL or token.",
      };
    },
  };
}

/**
 * Discover connection-capable providers and group their configured connections.
 * Exported so the grouping behavior is unit-testable with injected fake
 * clients. When `providerId` is given, only that provider is queried.
 *
 * Both reads degrade gracefully: if the action catalog can't be fetched there
 * are no providers to surface, and a per-provider connection-listing failure
 * yields an empty connection list for that provider rather than a hard error.
 * The model then gets a usable (possibly empty) result instead of a tool crash.
 */
export async function listProviderConnections({
  rpcClient,
  providerId,
}: {
  rpcClient: RpcClient;
  providerId?: string;
}): Promise<z.infer<typeof ProviderConnectionsSchema>[]> {
  const automationClient = rpcClient.forPlugin(AutomationApi);
  const integrationClient = rpcClient.forPlugin(IntegrationApi);

  // Connection-capable providers are exactly the distinct
  // `connectionProviderId`s declared by actions in the catalog. This RPC is
  // gated by the same `automation.read` rule as this tool, so an authorized
  // reader can always reach it. On failure we have nothing to list - return
  // empty rather than surfacing a hard error to the model.
  const providerIds = new Set<string>();
  try {
    const { items } = await automationClient.listActions();
    for (const action of items) {
      if (
        action.connectionProviderId !== undefined &&
        (providerId === undefined ||
          action.connectionProviderId === providerId)
      ) {
        providerIds.add(action.connectionProviderId);
      }
    }
  } catch {
    return [];
  }

  const grouped = await Promise.all(
    [...providerIds].map(async (qualifiedProviderId) => {
      let connections: Array<{ id: string; name: string }>;
      try {
        // Name-only summaries: callable by any authenticated principal (unlike
        // the admin-gated listConnections), so a non-admin automation author
        // still discovers the connectionIds they may wire.
        const listed = await integrationClient.listConnectionSummaries({
          providerId: qualifiedProviderId,
        });
        connections = listed.map((connection) => ({
          id: connection.id,
          name: connection.name,
        }));
      } catch {
        // A per-provider lookup failure (transient) becomes an empty connection
        // list, not a hard tool error.
        connections = [];
      }
      return {
        providerId: qualifiedProviderId,
        connections,
      };
    }),
  );

  return grouped;
}
