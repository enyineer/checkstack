/**
 * Propose-time validation that needs the user-scoped RPC client (so the
 * AI's drafted automation is rejected on the REVIEW card, not at run time).
 *
 * The structural + semantic + artifact-wiring checks already run inside the
 * automation plugin's `validateDefinition` RPC. The two checks here can't:
 * they depend on live, caller-scoped reads of OTHER plugins -
 *
 *   1. `runAs` - the application (service account) must EXIST and be BINDABLE
 *      by the caller (its access rules a subset of the caller's). Reuses the
 *      auth plugin's `getBindableApplications`, the single source of truth the
 *      "Run as" picker and the create/update gate both use, so the model can't
 *      fabricate a `runAs` that does not exist or that it may not bind.
 *   2. `connectionId` - each integration-provider action's literal
 *      `config.connectionId` must reference a connection actually configured
 *      for that action's provider, so the model can't invent a connection (or
 *      hand-roll a URL/token) that fails at execute time.
 *
 * Both run through the USER-SCOPED client, so the same access checks a direct
 * UI/RPC call would face apply here too.
 */
import type { RpcClient } from "@checkstack/backend-api";
import { AuthApi } from "@checkstack/auth-common";
import { IntegrationApi } from "@checkstack/integration-common";
import { AutomationApi } from "@checkstack/automation-common";
import {
  collectConnectionIdIssues,
  type DefinitionIssue,
  type IntegrationConnectionLookup,
  type ResolveConnectionProviderId,
} from "../validate-definition";
import type { AutomationProposeInput } from "./automation-propose";

/**
 * Run the caller-scoped propose-time checks (`runAs` bindability +
 * `connectionId` existence) and return any issues. Network failures are
 * swallowed into soft "could not verify" issues rather than thrown, so a
 * transient outage never silently waves a broken draft through.
 */
export async function collectProposeIssues({
  input,
  rpcClient,
}: {
  input: AutomationProposeInput;
  rpcClient: RpcClient;
}): Promise<DefinitionIssue[]> {
  const [runAsIssues, connectionIssues] = await Promise.all([
    collectRunAsIssues({ runAs: input.runAs, rpcClient }),
    collectProposeConnectionIssues({ input, rpcClient }),
  ]);
  return [...runAsIssues, ...connectionIssues];
}

/**
 * Validate the proposed `runAs` against the caller's bindable service accounts.
 * `getBindableApplications` already encapsulates the existence + subset-of-
 * caller-rules check (see `isApplicationBindable`), so a `runAs` absent from
 * that list is either unknown or not bindable by this caller - both fatal.
 */
async function collectRunAsIssues({
  runAs,
  rpcClient,
}: {
  runAs: string;
  rpcClient: RpcClient;
}): Promise<DefinitionIssue[]> {
  let bindable: Array<{ id: string }>;
  try {
    bindable = await rpcClient.forPlugin(AuthApi).getBindableApplications();
  } catch {
    return [
      {
        path: ["runAs"],
        message: `Could not verify the service account "${runAs}" - the bindable service accounts could not be listed. Call automation.listServiceAccounts to choose a valid one.`,
      },
    ];
  }

  if (bindable.some((app) => app.id === runAs)) return [];
  return [
    {
      path: ["runAs"],
      message: `Service account "${runAs}" does not exist or you are not allowed to bind it - call automation.listServiceAccounts to choose a valid one.`,
    },
  ];
}

/**
 * Validate every integration-provider action's literal `connectionId` against
 * the connections configured for its provider, reusing the shared
 * `collectConnectionIdIssues` walk. The provider-id resolver comes from the
 * automation plugin's `listActions` (which surfaces `connectionProviderId`),
 * and the connection lookup from the user-scoped integration client.
 */
async function collectProposeConnectionIssues({
  input,
  rpcClient,
}: {
  input: AutomationProposeInput;
  rpcClient: RpcClient;
}): Promise<DefinitionIssue[]> {
  const automationClient = rpcClient.forPlugin(AutomationApi);
  const integrationClient = rpcClient.forPlugin(IntegrationApi);

  const providerByActionId = new Map<string, string>();
  try {
    const { items } = await automationClient.listActions();
    for (const action of items) {
      if (action.connectionProviderId !== undefined) {
        providerByActionId.set(action.qualifiedId, action.connectionProviderId);
      }
    }
  } catch {
    // Without the action catalog we cannot tell which actions are
    // connection-backed; skip rather than emit misleading issues.
    return [];
  }

  const resolveConnectionProviderId: ResolveConnectionProviderId = (actionId) =>
    providerByActionId.get(actionId);

  const connectionLookup: IntegrationConnectionLookup = {
    async listConnectionIds({ providerId }) {
      try {
        // Name-only summaries: callable by any authenticated principal, so a
        // non-admin automation author still gets a real connectionId check
        // (rather than the admin-gated listConnections soft-degrading).
        const connections = await integrationClient.listConnectionSummaries({
          providerId,
        });
        return connections.map((connection) => connection.id);
      } catch {
        // A lookup failure surfaces downstream as a soft "could not verify"
        // note rather than a false "unknown connection".
        return;
      }
    },
  };

  return collectConnectionIdIssues({
    actions: input.definition.actions,
    resolveConnectionProviderId,
    connectionLookup,
  });
}
