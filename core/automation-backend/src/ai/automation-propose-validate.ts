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
import {
  buildResolverContext,
  collectProviderActionNodes,
  listResolverFields,
  CONNECTION_DEP,
} from "./action-options";
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
  // Fetch the caller's bindable service accounts ONCE (now carrying each app's
  // effective accessRules) and feed both the runAs-bindability and the
  // action-permission checks; `undefined` marks a lookup failure.
  const bindable = await fetchBindableApplications(rpcClient);

  const [runAsIssues, connectionIssues, optionIssues, actionRuleIssues] =
    await Promise.all([
      collectRunAsIssues({ runAs: input.runAs, bindable }),
      collectProposeConnectionIssues({ input, rpcClient }),
      collectOptionsIssues({ input, rpcClient }),
      collectActionRuleIssues({ input, rpcClient, bindable }),
    ]);
  return [
    ...runAsIssues,
    ...connectionIssues,
    ...optionIssues,
    ...actionRuleIssues,
  ];
}

/** A bindable service account with its resolved effective access rules. */
interface BindableApp {
  id: string;
  name: string;
  accessRules: string[];
}

/**
 * The caller's bindable service accounts (with effective rules), or `undefined`
 * when the lookup failed so callers can degrade to a soft "could not verify".
 */
async function fetchBindableApplications(
  rpcClient: RpcClient,
): Promise<BindableApp[] | undefined> {
  try {
    return await rpcClient.forPlugin(AuthApi).getBindableApplications();
  } catch {
    return undefined;
  }
}

/**
 * Validate the proposed `runAs` against the caller's bindable service accounts.
 * `getBindableApplications` already encapsulates the existence + subset-of-
 * caller-rules check (see `isApplicationBindable`), so a `runAs` absent from
 * that list is either unknown or not bindable by this caller - both fatal.
 */
async function collectRunAsIssues({
  runAs,
  bindable,
}: {
  runAs: string;
  bindable: BindableApp[] | undefined;
}): Promise<DefinitionIssue[]> {
  if (bindable === undefined) {
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
 * Verify the proposed `runAs` service account holds every access rule the
 * draft's actions require (the SAME rules the dispatch engine enforces at run
 * time), so an author learns on the REVIEW CARD that e.g. the chosen service
 * account cannot create Jira issues - rather than the automation silently
 * failing on first run. Only the `runAs` app's own effective rules are needed
 * (already on the bindable list); the action requirements come from the action
 * catalog. Degrades softly: a missing app or unreadable catalog is left to the
 * runAs check / skipped, never a false "missing rule".
 */
async function collectActionRuleIssues({
  input,
  rpcClient,
  bindable,
}: {
  input: AutomationProposeInput;
  rpcClient: RpcClient;
  bindable: BindableApp[] | undefined;
}): Promise<DefinitionIssue[]> {
  if (bindable === undefined) return []; // runAs check already soft-noted
  const app = bindable.find((a) => a.id === input.runAs);
  if (!app) return []; // runAs check already flags unknown/unbindable
  const appRules = app.accessRules ?? [];
  if (appRules.includes("*")) return [];
  const granted = new Set(appRules);

  // action id -> required rules, from the action catalog.
  const requiredByAction = new Map<string, string[]>();
  try {
    const { items } = await rpcClient.forPlugin(AutomationApi).listActions();
    for (const action of items) {
      if (action.requiredAccessRules && action.requiredAccessRules.length > 0) {
        requiredByAction.set(action.qualifiedId, action.requiredAccessRules);
      }
    }
  } catch {
    return []; // can't read the catalog; skip rather than misreport
  }

  const issues: DefinitionIssue[] = [];
  for (const { action, path } of collectProviderActionNodes(
    input.definition.actions,
  )) {
    const required = requiredByAction.get(action.action);
    if (!required) continue;
    const missing = required.filter((rule) => !granted.has(rule));
    if (missing.length > 0) {
      issues.push({
        path: [...path, "action"],
        message: `Service account "${app.name}" is not permitted to run "${action.action}": missing access rule(s) ${missing.join(", ")}. Grant the rule(s) to the service account's role, or pick a runAs that already holds them.`,
      });
    }
  }
  return issues;
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
    // connection-backed, so the connectionId check is skipped entirely. Surface
    // that as a soft "could not verify" issue rather than returning [] - a
    // silently dropped check reads as "all connections valid" and lets a
    // fabricated connectionId through. The soft issue still blocks the proposal,
    // so the model retries instead of the gap being invisible.
    return [
      {
        path: ["definition"],
        message:
          "Could not verify connectionId references - the action catalog could not be listed. Retry, or call automation.listConnections to confirm each integration action's connectionId exists.",
      },
    ];
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isTemplate(value: string): boolean {
  return value.includes("{{") || value.includes("${{");
}

/**
 * Validate every provider action's literal dynamic-option (`x-options-resolver`)
 * config values against the LIVE options for its connection - the same check the
 * editor's dropdowns enforce, so the AI can't ship a fabricated `projectKey` /
 * `issueTypeId` / etc. that the UI would never have allowed.
 *
 * Provider-agnostic: it reads each action's resolver fields and their
 * dependencies from the action schema, sources each field's dependency values
 * from the SAME literal config (so a cascade like issueTypeId->projectKey
 * resolves), and flags a literal value absent from the resolved set.
 *
 * Deliberately conservative to avoid false positives and over-blocking:
 *   - Templated or absent values (and fields whose dependencies are
 *     templated/absent) are skipped - they can only be resolved at run time.
 *   - A resolver LOOKUP failure (provider briefly unreachable) is skipped rather
 *     than blocking the proposal; the connection itself is already validated by
 *     the connectionId check, so transient option-fetch flakiness must not gate
 *     every proposal. Only a value the provider definitively does not offer is
 *     flagged.
 */
async function collectOptionsIssues({
  input,
  rpcClient,
}: {
  input: AutomationProposeInput;
  rpcClient: RpcClient;
}): Promise<DefinitionIssue[]> {
  const automationClient = rpcClient.forPlugin(AutomationApi);
  const integrationClient = rpcClient.forPlugin(IntegrationApi);

  // action id -> { providerId, configSchema } for connection-backed actions.
  const meta = new Map<string, { providerId: string; configSchema: unknown }>();
  try {
    const { items } = await automationClient.listActions();
    for (const action of items) {
      if (action.connectionProviderId !== undefined) {
        meta.set(action.qualifiedId, {
          providerId: action.connectionProviderId,
          configSchema: action.configSchema,
        });
      }
    }
  } catch {
    // The connectionId check already surfaces a soft "catalog unavailable"
    // issue; don't double-report it here.
    return [];
  }

  const issues: DefinitionIssue[] = [];
  // Cache the resolved value-set per (provider, connection, resolver, context)
  // so an automation with several actions on the same dropdown hits the provider
  // once. `null` marks a lookup failure (skip, do not block).
  const cache = new Map<string, Promise<Set<string> | null>>();

  for (const { action, path } of collectProviderActionNodes(
    input.definition.actions,
  )) {
    const entry = meta.get(action.action);
    if (!entry) continue;
    const config = asRecord(action.config);
    if (!config) continue;

    const connectionId = config[CONNECTION_DEP];
    if (typeof connectionId !== "string" || connectionId.length === 0) continue;
    if (isTemplate(connectionId)) continue;

    for (const resolver of listResolverFields(entry.configSchema)) {
      if (resolver.field === CONNECTION_DEP) continue;

      const raw = config[resolver.field];
      if (typeof raw !== "string" || raw.length === 0) continue;
      if (isTemplate(raw)) continue;

      // Dependency values come from this action's own literal config; if any is
      // missing or templated we cannot resolve, so skip this field.
      const { context, missing } = buildResolverContext({
        dependsOn: resolver.dependsOn,
        values: config,
      });
      if (missing.length > 0) continue;

      const key = `${entry.providerId}|${connectionId}|${resolver.resolverName}|${JSON.stringify(context)}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = integrationClient
          .resolveConnectionOptions({
            providerId: entry.providerId,
            connectionId,
            resolverName: resolver.resolverName,
            context,
          })
          .then((options) => new Set(options.map((option) => option.value)))
          .catch(() => null);
        cache.set(key, pending);
      }
      const validValues = await pending;
      if (validValues === null) continue; // lookup failed - skip, don't block
      if (!validValues.has(raw)) {
        issues.push({
          path: [...path, "config", resolver.field],
          message: `"${raw}" is not a valid ${resolver.field} for connection "${connectionId}". Call automation.resolveActionOptions({ action: "${action.action}", field: "${resolver.field}", connectionId, ... }) to pick a valid value.`,
        });
      }
    }
  }

  return issues;
}
