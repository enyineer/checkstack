import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient } from "@checkstack/backend-api";
import {
  AutomationApi,
  automationAccess,
  pluginMetadata as automationPluginMetadata,
} from "@checkstack/automation-common";
import {
  type GetCapabilitySchemaOutput,
  type ListCapabilitiesOutput,
  GetCapabilitySchemaOutputSchema,
  ListCapabilitiesOutputSchema,
  applyCapabilitySizeGate,
  summarizeConfigSchema,
  type RawCapabilityEntry,
} from "@checkstack/ai-common";
import { z } from "zod";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/**
 * The single access rule that authorizes BOTH automation capability tools: the
 * automation read rule. These are single-context tools (automation only), so the
 * resolver gate maps directly to the rule that gates the underlying RPCs - no
 * in-execute per-context re-check is needed. The fan-out uses the USER-SCOPED
 * client passed at call time, so handler-side authorization (access rules AND
 * per-resource/team scope) is enforced exactly as a direct UI/RPC call.
 */
const AUTOMATION_READ_RULE = qualifyAccessRuleId(
  automationPluginMetadata,
  automationAccess.read,
);

/**
 * A fully-derived catalog entry that ALSO carries its full config JSON Schema.
 * `automation.listCapabilities` size-gates the summary out of
 * `RawCapabilityEntry`; `automation.getCapabilitySchema` reads `configSchema`
 * from the same source to return one kind's full schema intact. Keeping both on
 * one row means a single fan-out powers both tools.
 */
interface AutomationCatalogEntry extends RawCapabilityEntry {
  configSchema: Record<string, unknown>;
}

/**
 * Fetch + normalize every automation capability (triggers + actions +
 * artifact-types) into rows carrying both the compact summary and the full
 * config schema. Pure mapping over the registry DTOs; the only I/O is the
 * user-scoped client fan-out.
 */
async function fetchCatalog({
  rpcClient,
}: {
  rpcClient: RpcClient;
}): Promise<AutomationCatalogEntry[]> {
  const automationClient = rpcClient.forPlugin(AutomationApi);
  const [triggers, actions, artifactTypes] = await Promise.all([
    automationClient.listTriggers(),
    automationClient.listActions(),
    automationClient.listArtifactTypes(),
  ]);
  const rows: AutomationCatalogEntry[] = [];
  for (const trigger of triggers.items) {
    rows.push({
      id: trigger.qualifiedId,
      displayName: trigger.displayName,
      description: trigger.description,
      role: "trigger",
      category: trigger.category,
      // Triggers carry an optional `configSchema`; the always-present
      // `payloadSchema` describes the emitted event, not the config form.
      configSchema: trigger.configSchema ?? {},
      configSummary: summarizeConfigSchema({
        configSchema: trigger.configSchema,
      }),
    });
  }
  for (const action of actions.items) {
    rows.push({
      id: action.qualifiedId,
      displayName: action.displayName,
      description: action.description,
      role: "action",
      category: action.category,
      configSchema: action.configSchema,
      configSummary: summarizeConfigSchema({
        configSchema: action.configSchema,
      }),
    });
  }
  for (const artifactType of artifactTypes.items) {
    rows.push({
      id: artifactType.qualifiedId,
      displayName: artifactType.displayName,
      description: artifactType.description,
      role: "artifact-type",
      configSchema: artifactType.schema,
      configSummary: summarizeConfigSchema({
        configSchema: artifactType.schema,
      }),
    });
  }
  return rows;
}

const AutomationListCapabilitiesInputSchema = z.object({});
type AutomationListCapabilitiesInput = z.infer<
  typeof AutomationListCapabilitiesInputSchema
>;

const AutomationGetCapabilitySchemaInputSchema = z.object({
  /** The fully-qualified kind id from an `automation.listCapabilities` entry. */
  kind: z.string().min(1),
});
type AutomationGetCapabilitySchemaInput = z.infer<
  typeof AutomationGetCapabilitySchemaInputSchema
>;

/**
 * `automation.listCapabilities` - the broad, size-gated automation catalog:
 * triggers + actions + artifact types. Sourced from the automation
 * registry-introspection RPCs (`listTriggers`/`listActions`/`listArtifactTypes`).
 * Each entry returns id, displayName, a short description, and a COMPACT config
 * summary (field names + types + required), gated so the broad catalog stays
 * small. `effect: "read"`.
 *
 * Authorization: gated directly by the automation read rule. The fan-out goes
 * through the user-scoped client passed at call time; handler authz applies.
 */
export function createAutomationListCapabilitiesTool(): RegisteredAiTool<
  AutomationListCapabilitiesInput,
  ListCapabilitiesOutput
> {
  return {
    name: "automation.listCapabilities",
    description:
      "List the available automation capability kinds: triggers, actions, and artifact types. Returns each kind's id, name, short description, and a COMPACT config summary (field names + types + required). The summary is omitted for large catalogs (truncated=true) - pull one kind's full schema with automation.getCapabilitySchema before configuring it.",
    effect: "read",
    input: AutomationListCapabilitiesInputSchema,
    output: ListCapabilitiesOutputSchema,
    requiredAccessRules: [AUTOMATION_READ_RULE],
    async execute({ rpcClient }) {
      const rows = await fetchCatalog({ rpcClient });
      const stripped: RawCapabilityEntry[] = rows.map(
        ({ configSchema: _schema, ...rest }) => rest,
      );
      const { entries, truncated } = applyCapabilitySizeGate({
        entries: stripped,
      });
      return { context: "automation", entries, truncated };
    },
  };
}

/**
 * `automation.getCapabilitySchema` - the FULL config JSON Schema for ONE
 * automation kind (trigger/action/artifact-type), returned intact (the same
 * schema that powers the UI config form). The two-level design keeps
 * `automation.listCapabilities` small while giving the model precise, complete
 * detail only for the specific kind it is configuring. Automation kinds are NOT
 * collectors, so there is no result schema or assertion-operator vocabulary
 * (those are healthcheck-collector-only). `effect: "read"`; gated identically to
 * `automation.listCapabilities`.
 */
export function createAutomationGetCapabilitySchemaTool(): RegisteredAiTool<
  AutomationGetCapabilitySchemaInput,
  GetCapabilitySchemaOutput
> {
  return {
    name: "automation.getCapabilitySchema",
    description:
      "Return the FULL config JSON Schema for ONE automation capability kind (a trigger, action, or artifact-type), identified by the id from automation.listCapabilities. Use this to get exact field shapes, types, required fields, and enums before drafting a config.",
    effect: "read",
    input: AutomationGetCapabilitySchemaInputSchema,
    output: GetCapabilitySchemaOutputSchema,
    requiredAccessRules: [AUTOMATION_READ_RULE],
    async execute({ input, rpcClient }) {
      const rows = await fetchCatalog({ rpcClient });
      const match = rows.find((row) => row.id === input.kind);
      if (!match) {
        const known = rows.map((row) => row.id).join(", ");
        throw new Error(
          `Unknown automation capability kind "${input.kind}". Known kinds: ${known || "(none)"}.`,
        );
      }
      const result: GetCapabilitySchemaOutput = {
        context: "automation",
        id: match.id,
        displayName: match.displayName,
        description: match.description,
        role: match.role,
        configSchema: match.configSchema,
      };
      return result;
    },
  };
}
