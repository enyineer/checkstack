import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient } from "@checkstack/backend-api";
import {
  AutomationApi,
  automationAccess,
  pluginMetadata as automationPluginMetadata,
} from "@checkstack/automation-common";
import {
  IntegrationApi,
  ConnectionOptionSchema,
} from "@checkstack/integration-common";
import { z } from "zod";
import type { RegisteredAiTool } from "@checkstack/ai-backend";
import {
  buildResolverContext,
  getResolverField,
  listResolverFields,
} from "./action-options";

/**
 * `automation.resolveActionOptions` - resolve the VALID values for a dynamic-
 * option (cascading dropdown) config field of an integration action, exactly as
 * the editor's dropdowns do. Many integration action fields (e.g. Jira
 * `projectKey` / `issueTypeId` / `priorityId`) are NOT free-form: their valid
 * values are fetched live from the connected system. The action's config schema
 * marks such a field with `x-options-resolver` (and `x-depends-on` for cascades).
 *
 * Without this tool the model can only guess those values; with it, it fetches
 * the real list and picks a valid one. Provider-agnostic: it reads the resolver
 * + dependencies from the action's own schema, so it works for every provider's
 * resolver fields. `effect: "read"`; gated by the automation read rule; the
 * fan-out uses the user-scoped client so handler authz applies.
 */
const AUTOMATION_READ_RULE = qualifyAccessRuleId(
  automationPluginMetadata,
  automationAccess.read,
);

const ResolveActionOptionsInputSchema = z.object({
  /** Fully-qualified action id (from automation.listCapabilities), e.g. "integration-jira.create_issue". */
  action: z.string().min(1),
  /** The config field to resolve options for, e.g. "projectKey" or "issueTypeId". */
  field: z.string().min(1),
  /** The connection the action will use (from automation.listConnections). */
  connectionId: z.string().min(1),
  /**
   * Values for the field's other dependencies (its `x-depends-on` minus
   * connectionId), e.g. `{ projectKey: "OPS" }` when resolving `issueTypeId`.
   * Resolve a dependency's own options first if it is itself a dropdown.
   */
  dependencies: z.record(z.string(), z.string()).optional(),
});
type ResolveActionOptionsInput = z.infer<typeof ResolveActionOptionsInputSchema>;

const ResolveActionOptionsOutputSchema = z.object({
  /** The valid options for the field (`value` is what to put in the config). */
  options: z.array(ConnectionOptionSchema),
  /** Guidance: pick a `value`, resolve a missing dependency first, etc. */
  note: z.string(),
});
type ResolveActionOptionsOutput = z.infer<
  typeof ResolveActionOptionsOutputSchema
>;

export function createAutomationResolveOptionsTool(): RegisteredAiTool<
  ResolveActionOptionsInput,
  ResolveActionOptionsOutput
> {
  return {
    name: "automation.resolveActionOptions",
    description:
      "Resolve the VALID values for a dynamic-option config field of an integration action (e.g. a Jira create_issue's projectKey, issueTypeId, or priorityId), fetched live from the connection - the same list the editor dropdown shows. Use this whenever a field's schema has `x-options-resolver` instead of guessing the value. For a cascading field, pass the fields it depends on via `dependencies` (e.g. { projectKey } when resolving issueTypeId), resolving each dependency's options first. Returns { options: [{ value, label }], note }.",
    effect: "read",
    input: ResolveActionOptionsInputSchema,
    output: ResolveActionOptionsOutputSchema,
    requiredAccessRules: [AUTOMATION_READ_RULE],
    async execute({ input, rpcClient }) {
      return resolveActionOptions({ input, rpcClient });
    },
  };
}

/** Exported for unit testing with injected fake clients. */
export async function resolveActionOptions({
  input,
  rpcClient,
}: {
  input: ResolveActionOptionsInput;
  rpcClient: RpcClient;
}): Promise<ResolveActionOptionsOutput> {
  const automationClient = rpcClient.forPlugin(AutomationApi);
  const integrationClient = rpcClient.forPlugin(IntegrationApi);

  let action;
  try {
    const { items } = await automationClient.listActions();
    action = items.find((item) => item.qualifiedId === input.action);
  } catch {
    return {
      options: [],
      note: "Could not load the action catalog to resolve options. Retry, or use automation.listCapabilities.",
    };
  }

  if (!action) {
    return {
      options: [],
      note: `Unknown action "${input.action}". Call automation.listCapabilities for valid action ids.`,
    };
  }

  const providerId = action.connectionProviderId;
  if (providerId === undefined) {
    return {
      options: [],
      note: `Action "${input.action}" is not connection-backed, so its fields are free-form (no dynamic options).`,
    };
  }

  const resolver = getResolverField(action.configSchema, input.field);
  if (!resolver) {
    const dynamicFields = listResolverFields(action.configSchema)
      .map((field) => field.field)
      .join(", ");
    return {
      options: [],
      note:
        `Field "${input.field}" on "${input.action}" has no dynamic options - provide a literal value. ` +
        (dynamicFields
          ? `Dynamic-option fields on this action: ${dynamicFields}.`
          : "This action has no dynamic-option fields."),
    };
  }

  const { context, missing } = buildResolverContext({
    dependsOn: resolver.dependsOn,
    values: input.dependencies ?? {},
  });
  if (missing.length > 0) {
    return {
      options: [],
      note: `Field "${input.field}" depends on ${missing.join(", ")}. Resolve/choose ${missing.join(", ")} first (each may itself be a dropdown) and pass them in dependencies.`,
    };
  }

  let options;
  try {
    options = await integrationClient.resolveConnectionOptions({
      providerId,
      connectionId: input.connectionId,
      resolverName: resolver.resolverName,
      context,
    });
  } catch {
    return {
      options: [],
      note: `Could not resolve options for "${input.field}" - the connection could not be reached or "${input.connectionId}" is not valid for this provider. Confirm the connectionId with automation.listConnections.`,
    };
  }

  return {
    options,
    note:
      options.length > 0
        ? `Use one of these option \`value\`s for "${input.field}" (never the label).`
        : `No options were returned for "${input.field}". Check the connectionId and any dependency values.`,
  };
}
