import {
  Versioned,
  z,
  configString,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
} from "@checkstack/backend-api";
import { pluginMetadata } from "./plugin-metadata";
import {
  snmpResultSchema,
  createSnmpAggregatedResult,
  mergeSnmpAggregated,
  type SnmpResult,
  type SnmpAggregatedResult,
} from "./schemas";
import type { SnmpTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

/**
 * Per-check config: which OID to read. The connection (host / credentials)
 * lives on the strategy config, so the collector only carries the operation.
 */
const snmpCollectorConfigSchema = z.object({
  // Templatable: supports `{{ environment.oid }}` so one check config fans out
  // across N environments. `.min(1)` still guards the STORED value (a `{{ }}`
  // template is non-empty); the CONCRETE rendered OID is re-checked POST-RENDER
  // in `execute` because an empty render must not run as a successful GET.
  oid: configString({ "x-templatable": true })
    .min(1)
    .describe(
      "Object identifier (OID) to query, e.g. 1.3.6.1.2.1.1.3.0. Supports templating, e.g. {{ environment.oid }}",
    ),
});

export type SnmpCollectorConfig = z.infer<typeof snmpCollectorConfigSchema>;

/**
 * Post-render validator for the rendered `oid`. An empty render (e.g. an
 * env-less run resolving `{{ environment.oid }}` to "") is a config error that
 * prevents the probe - transport-failure semantics - not a healthy empty GET.
 */
const renderedOidSchema = z.string().trim().min(1);

// ============================================================================
// SNMP COLLECTOR
// ============================================================================

/**
 * Built-in SNMP collector. Reads a single OID and exposes the returned value,
 * its SNMP type, and the round-trip time as assertable metrics. Only a genuine
 * transport failure (surfaced as `error` by the transport client) fails the
 * collector; every value the agent returns - including exception varbinds - is
 * a completed response the user asserts on.
 */
export class SnmpCollector implements CollectorStrategy<
  SnmpTransportClient,
  SnmpCollectorConfig,
  SnmpResult,
  SnmpAggregatedResult
> {
  id = "snmp";
  displayName = "SNMP GET";
  description = "Read an SNMP OID and check its value";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: snmpCollectorConfigSchema });
  result = new Versioned({ version: 1, schema: snmpResultSchema });
  aggregatedResult = createSnmpAggregatedResult();

  async execute({
    config,
    client,
  }: {
    config: SnmpCollectorConfig;
    client: SnmpTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<SnmpResult>> {
    // Post-render guard: `oid` is a templatable string, so `.min(1)` cannot run
    // at store time. The executor has already rendered `{{ environment.* }}`
    // into `config.oid`; reject a render that collapsed to empty here so the run
    // fails clearly instead of issuing a GET for an empty OID.
    const oid = renderedOidSchema.safeParse(config.oid);
    if (!oid.success) {
      return {
        result: {
          valueType: "error",
          responseTimeMs: 0,
        },
        error:
          `Rendered OID is empty: ${JSON.stringify(config.oid)}. ` +
          `Check the {{ environment.* }} templating for this environment.`,
      };
    }

    const response = await client.exec({ oid: oid.data });

    return {
      result: {
        value: response.value,
        valueString: response.valueString,
        valueType: response.valueType,
        responseTimeMs: response.responseTimeMs,
      },
      error: response.error,
    };
  }

  mergeResult(
    existing: SnmpAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<SnmpResult>,
  ): SnmpAggregatedResult {
    return mergeSnmpAggregated(existing, run);
  }
}
