import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient } from "@checkstack/backend-api";
import {
  NumericOperators,
  StringOperators,
  BooleanOperators,
  ArrayOperators,
  DynamicOperators,
} from "@checkstack/backend-api";
import {
  HealthCheckApi,
  healthCheckAccess,
  pluginMetadata as healthcheckPluginMetadata,
} from "@checkstack/healthcheck-common";
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
 * A fully-derived health-check catalog entry that ALSO carries its full config
 * JSON Schema. `listCapabilities` size-gates the summary out of
 * `RawCapabilityEntry`; `getCapabilitySchema` reads `configSchema` from the same
 * source to return one kind's full schema intact. Keeping both on one row means
 * a single fan-out powers both tools.
 */
interface CatalogEntryWithSchema extends RawCapabilityEntry {
  configSchema: Record<string, unknown>;
  /** Health-check collectors carry a result schema (its fields are assertable). */
  resultSchema?: Record<string, unknown>;
}

/**
 * Valid assertion operators per JSON type (and `jsonpath`), surfaced alongside a
 * collector's result schema so the model authors assertions with the canonical
 * operator words instead of guessing. Same vocabulary as the runtime evaluator
 * and the editor's AssertionBuilder (`@checkstack/backend-api` assertion enums).
 */
const ASSERTION_OPERATORS: Record<string, string[]> = {
  number: [...NumericOperators.options],
  integer: [...NumericOperators.options],
  string: [...StringOperators.options],
  boolean: [...BooleanOperators.options],
  array: [...ArrayOperators.options],
  jsonpath: [...DynamicOperators.options],
};

/**
 * The healthcheck config read rule that gates BOTH capability tools. This is a
 * single-context reader (healthcheck only), so the resolver gate by the
 * healthcheck config read rule is the authority - there is no cross-context
 * surface, so no in-execute context assertion is needed: the tool only ever
 * reads healthcheck data via the USER-SCOPED client passed at call time, so
 * handler-side authorization is enforced exactly as a direct UI/RPC call.
 */
const HEALTHCHECK_READ_RULE = qualifyAccessRuleId(
  healthcheckPluginMetadata,
  healthCheckAccess.configuration.read,
);

/**
 * Fetch + normalize every health-check capability into rows carrying both the
 * compact summary and the full config schema. Pure mapping over the registry
 * DTOs; the only I/O is the user-scoped-client fan-out
 * (`getStrategies` + per-strategy `getCollectors`).
 */
async function fetchCatalog({
  rpcClient,
}: {
  rpcClient: RpcClient;
}): Promise<CatalogEntryWithSchema[]> {
  const healthcheckClient = rpcClient.forPlugin(HealthCheckApi);
  const strategies = await healthcheckClient.getStrategies();
  const rows: CatalogEntryWithSchema[] = [];
  for (const strategy of strategies) {
    rows.push({
      id: strategy.id,
      displayName: strategy.displayName,
      description: strategy.description,
      role: "strategy",
      category: strategy.category,
      configSchema: strategy.configSchema,
      configSummary: summarizeConfigSchema({
        configSchema: strategy.configSchema,
      }),
    });
    const collectors = await healthcheckClient.getCollectors({
      strategyId: strategy.id,
    });
    for (const collector of collectors) {
      rows.push({
        id: collector.id,
        displayName: collector.displayName,
        description: collector.description,
        role: "collector",
        category: strategy.displayName,
        configSchema: collector.configSchema,
        // The collector's result schema: its top-level fields are the
        // assertable fields the model authors assertions against.
        resultSchema: collector.resultSchema,
        configSummary: summarizeConfigSchema({
          configSchema: collector.configSchema,
        }),
      });
    }
  }
  return rows;
}

export const HealthcheckListCapabilitiesInputSchema = z.object({});
export type HealthcheckListCapabilitiesInput = z.infer<
  typeof HealthcheckListCapabilitiesInputSchema
>;

/**
 * `healthcheck.listCapabilities` - the broad, size-gated catalog of health-check
 * strategies + collectors. Sourced from the registry-introspection RPCs
 * (`getStrategies`/`getCollectors`). Each entry returns id, displayName, a short
 * description, and a COMPACT config summary (field names + types + required),
 * gated so the broad catalog stays small. `effect: "read"`.
 *
 * This is a single-context (healthcheck-only) tool, so it is gated directly by
 * the healthcheck config read rule - the resolver gate is the authority and no
 * in-execute context check is needed (it only ever reads healthcheck data via
 * the USER-SCOPED client passed at call time).
 */
export function createHealthcheckListCapabilitiesTool(): RegisteredAiTool<
  HealthcheckListCapabilitiesInput,
  ListCapabilitiesOutput
> {
  return {
    name: "healthcheck.listCapabilities",
    description:
      "List the available health-check capability kinds: strategies + collectors. Returns each kind's id, name, short description, and a COMPACT config summary (field names + types + required). The summary is omitted for large catalogs (truncated=true) - pull one kind's full schema with healthcheck.getCapabilitySchema before configuring it.",
    effect: "read",
    input: HealthcheckListCapabilitiesInputSchema,
    output: ListCapabilitiesOutputSchema,
    requiredAccessRules: [HEALTHCHECK_READ_RULE],
    async execute({ rpcClient }) {
      const rows = await fetchCatalog({ rpcClient });
      const stripped: RawCapabilityEntry[] = rows.map(
        ({ configSchema: _schema, resultSchema: _result, ...rest }) => rest,
      );
      const { entries, truncated } = applyCapabilitySizeGate({
        entries: stripped,
      });
      return { context: "healthcheck", entries, truncated };
    },
  };
}

export const HealthcheckGetCapabilitySchemaInputSchema = z.object({
  /** The fully-qualified kind id from a `healthcheck.listCapabilities` entry. */
  kind: z.string().min(1),
});
export type HealthcheckGetCapabilitySchemaInput = z.infer<
  typeof HealthcheckGetCapabilitySchemaInputSchema
>;

/**
 * `healthcheck.getCapabilitySchema` - the FULL config JSON Schema for ONE
 * health-check kind, returned intact (the same schema that powers the UI config
 * form). The two-level design keeps `listCapabilities` small while giving the
 * model precise, complete detail only for the specific strategy/collector it is
 * configuring. For collectors it ALSO returns the assertable `resultSchema` plus
 * the valid `assertionOperators` vocabulary. `effect: "read"`; gated identically
 * to `healthcheck.listCapabilities`.
 */
export function createHealthcheckGetCapabilitySchemaTool(): RegisteredAiTool<
  HealthcheckGetCapabilitySchemaInput,
  GetCapabilitySchemaOutput
> {
  return {
    name: "healthcheck.getCapabilitySchema",
    description:
      "Return the FULL config JSON Schema for ONE health-check capability kind (a strategy or collector), identified by the id from healthcheck.listCapabilities. Use this to get exact field shapes, types, required fields, and enums before drafting a config. For collectors it also returns the assertable result fields (resultSchema) and the valid assertion operators per type.",
    effect: "read",
    input: HealthcheckGetCapabilitySchemaInputSchema,
    output: GetCapabilitySchemaOutputSchema,
    requiredAccessRules: [HEALTHCHECK_READ_RULE],
    async execute({ input, rpcClient }) {
      const rows = await fetchCatalog({ rpcClient });
      const match = rows.find((row) => row.id === input.kind);
      if (!match) {
        const known = rows.map((row) => row.id).join(", ");
        throw new Error(
          `Unknown healthcheck capability kind "${input.kind}". Known kinds: ${known || "(none)"}.`,
        );
      }
      const result: GetCapabilitySchemaOutput = {
        context: "healthcheck",
        id: match.id,
        displayName: match.displayName,
        description: match.description,
        role: match.role,
        configSchema: match.configSchema,
        // For collectors, also expose the assertable result fields + the valid
        // operator vocabulary so the model authors assertions correctly (field
        // from resultSchema, operator a full word) instead of guessing.
        ...(match.role === "collector" && match.resultSchema
          ? {
              resultSchema: match.resultSchema,
              assertionOperators: ASSERTION_OPERATORS,
            }
          : {}),
      };
      return result;
    },
  };
}
