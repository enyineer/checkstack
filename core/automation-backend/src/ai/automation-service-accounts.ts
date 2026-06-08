import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient } from "@checkstack/backend-api";
import { AuthApi } from "@checkstack/auth-common";
import {
  automationAccess,
  pluginMetadata as automationPluginMetadata,
} from "@checkstack/automation-common";
import { z } from "zod";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/**
 * The automation read rule gates this discovery tool, identically to the
 * capability tools: it is a single-context (automation-only) read whose fan-out
 * goes through the USER-SCOPED client passed at call time, so handler-side
 * authorization is enforced exactly as a direct UI/RPC call.
 */
const AUTOMATION_READ_RULE = qualifyAccessRuleId(
  automationPluginMetadata,
  automationAccess.read,
);

const AutomationListServiceAccountsInputSchema = z.object({});
type AutomationListServiceAccountsInput = z.infer<
  typeof AutomationListServiceAccountsInputSchema
>;

/** One bindable service account the user may set as an automation's `runAs`. */
const ServiceAccountEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /**
   * The account's effective access rules (qualified ids; `["*"]` for an admin).
   * Match these against each action's `requiredAccessRules` (from
   * `automation.getCapabilitySchema`) to pick a `runAs` that can actually run
   * the automation - rather than proposing and being rejected.
   */
  accessRules: z.array(z.string()),
});

const AutomationListServiceAccountsOutputSchema = z.object({
  /** Service accounts the caller may bind as a `runAs`; pick exactly one. */
  serviceAccounts: z.array(ServiceAccountEntrySchema),
  /** Guidance the model must honor when picking a `runAs`. */
  note: z.string(),
});
type AutomationListServiceAccountsOutput = z.infer<
  typeof AutomationListServiceAccountsOutputSchema
>;

/**
 * `automation.listServiceAccounts` - the discovery tool for a valid `runAs`.
 * The model MUST call this before `automation.propose` to pick a real,
 * bindable service account id; inventing one (e.g. "system") makes the
 * automation fail to save. Implemented by the auth plugin's
 * `getBindableApplications`, which returns exactly the applications whose
 * resolved access rules are a subset of the caller's. `effect: "read"`.
 *
 * Authorization: gated by the automation read rule. The bindable list is
 * resolved through the user-scoped client, so handler authz applies. The
 * subset filter is the SAME predicate (`isApplicationBindable`) the automation
 * create / update handler enforces at save time and the "Run as" picker uses,
 * so what this tool surfaces is exactly what `automation.propose` will accept.
 */
export function createAutomationListServiceAccountsTool(): RegisteredAiTool<
  AutomationListServiceAccountsInput,
  AutomationListServiceAccountsOutput
> {
  return {
    name: "automation.listServiceAccounts",
    description:
      "List the service accounts (applications) you may bind as an automation's runAs, EACH WITH ITS access rules. Call this BEFORE automation.propose and pick one whose accessRules cover every requiredAccessRules of the actions you use (see automation.getCapabilitySchema) - so the automation can actually run, instead of being rejected at propose time. NEVER invent a runAs - values like \"system\" are NOT valid. Returns each account's id, name, optional description, and accessRules.",
    effect: "read",
    input: AutomationListServiceAccountsInputSchema,
    output: AutomationListServiceAccountsOutputSchema,
    requiredAccessRules: [AUTOMATION_READ_RULE],
    async execute({ rpcClient }) {
      const serviceAccounts = await listBindableServiceAccounts({ rpcClient });
      return {
        serviceAccounts,
        note: buildServiceAccountsNote(serviceAccounts),
      };
    },
  };
}

/**
 * Resolve the service accounts the caller may bind as a `runAs`. Delegates to
 * the auth plugin's `getBindableApplications`, the single source of truth the
 * "Run as" picker and the create / update bind gate both use: it performs the
 * existence + subset-of-caller-rules check (`isApplicationBindable`)
 * server-side and is `userType: "user"` with no extra access requirement, so it
 * works for any caller who can read automations (not only application admins).
 * Exported so the discovery behavior is unit-testable with an injected client.
 */
export async function listBindableServiceAccounts({
  rpcClient,
}: {
  rpcClient: RpcClient;
}): Promise<z.infer<typeof ServiceAccountEntrySchema>[]> {
  const authClient = rpcClient.forPlugin(AuthApi);
  const bindable = await authClient.getBindableApplications();

  return bindable.map((app) => ({
    id: app.id,
    name: app.name,
    ...(app.description ? { description: app.description } : {}),
    accessRules: app.accessRules ?? [],
  }));
}

/**
 * Model-facing guidance for picking a `runAs`: match the account's `accessRules`
 * to the actions' `requiredAccessRules`, and - crucially - ASK the operator when
 * the choice is ambiguous, rather than guessing the identity an automation runs
 * as (a security-relevant decision).
 */
function buildServiceAccountsNote(
  serviceAccounts: z.infer<typeof ServiceAccountEntrySchema>[],
): string {
  if (serviceAccounts.length === 0) {
    return "You have no bindable service accounts. Ask an admin to create one (or grant you a matching one) before proposing an automation; do not invent a runAs.";
  }
  if (serviceAccounts.length === 1) {
    return "Use this account's id as runAs. Confirm its accessRules cover every requiredAccessRules of the actions you use; if not, tell the operator which rule(s) to grant rather than proposing a draft that will be rejected.";
  }
  return "Multiple service accounts are available. Pick one whose accessRules cover every requiredAccessRules of the actions you use. If more than one qualifies (or the operator did not say which to use), ASK the operator which service account to run as - do not pick the automation's identity for them. If none has the needed rules, say which rule(s) to grant.";
}
