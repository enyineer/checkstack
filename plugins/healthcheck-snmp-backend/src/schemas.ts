import {
  z,
  configString,
  configNumber,
  configSecret,
  baseStrategyConfigSchema,
  aggregatedAverage,
  aggregatedCounter,
  mergeAverage,
  mergeCounter,
  VersionedAggregated,
  type HealthCheckRunForAggregation,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultSchema,
} from "@checkstack/healthcheck-common";

// ============================================================================
// CONNECTION CONFIG (shared by the strategy)
// ============================================================================

/** Supported SNMP protocol versions. */
export const snmpVersionSchema = z.enum(["1", "2c", "3"]);
export type SnmpVersion = z.infer<typeof snmpVersionSchema>;

/** SNMPv3 security level. */
export const snmpSecurityLevelSchema = z.enum([
  "noAuthNoPriv",
  "authNoPriv",
  "authPriv",
]);
export type SnmpSecurityLevel = z.infer<typeof snmpSecurityLevelSchema>;

/** SNMPv3 authentication protocol. */
export const snmpAuthProtocolSchema = z.enum([
  "md5",
  "sha",
  "sha224",
  "sha256",
  "sha384",
  "sha512",
]);
export type SnmpAuthProtocol = z.infer<typeof snmpAuthProtocolSchema>;

/** SNMPv3 privacy (encryption) protocol. */
export const snmpPrivProtocolSchema = z.enum([
  "des",
  "aes",
  "aes256b",
  "aes256r",
]);
export type SnmpPrivProtocol = z.infer<typeof snmpPrivProtocolSchema>;

/**
 * Connection configuration for the SNMP strategy. Holds the agent target plus
 * v2c community / v3 credentials. Secrets (`community`, `v3AuthKey`,
 * `v3PrivKey`) use `configSecret` so they are extracted, redacted on read, and
 * resolved at run time - never stored in plaintext.
 */
export const snmpConfigSchema = baseStrategyConfigSchema.extend({
  // Templatable: supports `{{ environment.host }}` so one check config fans out
  // across N environments/systems. Presence is NOT enforced here with `.min(1)`
  // because `createClient` re-validates the ALREADY-RENDERED config, and an
  // env-less run legitimately renders the template to "" - so emptiness is
  // enforced POST-RENDER in `createClient` (see {@link renderedHostSchema}),
  // matching the other strategy connection fields (TCP/MySQL host).
  host: configString({ "x-templatable": true }).describe(
    "Hostname or IP address of the SNMP agent. Supports templating, e.g. {{ environment.host }}",
  ),
  port: configNumber({})
    .int()
    .min(1)
    .max(65_535)
    .default(161)
    .describe("SNMP UDP port"),
  version: snmpVersionSchema.default("2c").describe("SNMP protocol version"),
  community: configSecret({ id: "community" })
    .default("public")
    .describe("SNMP community string (v1 / v2c)"),
  v3Username: configString({})
    .optional()
    .describe("SNMPv3 security user name"),
  v3SecurityLevel: snmpSecurityLevelSchema
    .default("authPriv")
    .describe("SNMPv3 security level"),
  v3AuthProtocol: snmpAuthProtocolSchema
    .optional()
    .describe("SNMPv3 authentication protocol"),
  v3AuthKey: configSecret({ id: "v3AuthKey" })
    .optional()
    .describe("SNMPv3 authentication key / password"),
  v3PrivProtocol: snmpPrivProtocolSchema
    .optional()
    .describe("SNMPv3 privacy protocol"),
  v3PrivKey: configSecret({ id: "v3PrivKey" })
    .optional()
    .describe("SNMPv3 privacy key / password"),
});

export type SnmpConfig = z.infer<typeof snmpConfigSchema>;

/**
 * Post-render validator for the rendered `host`. An empty render (e.g. an
 * env-less run resolving `{{ environment.host }}` to "") is a config error that
 * prevents the probe - transport-failure semantics - not a healthy empty host.
 */
export const renderedHostSchema = z.string().trim().min(1);

// ============================================================================
// RESULT SCHEMA (shared by strategy + collector)
// ============================================================================

export const snmpResultSchema = healthResultSchema({
  // The returned OID value as a number, when representable. Arbitrary OIDs have
  // no inherent "good" direction, so anomaly detection watches for a two-sided
  // deviation from the learned baseline rather than a monotonic trend.
  value: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "OID Value",
    "x-chart-priority": 10,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "deviation",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
  }).optional(),
  // Lossless string form of the value (also carries Counter64 values that
  // exceed JS safe-integer range, and non-numeric OctetString / OID / IP
  // values). Assertable text; not a meaningful anomaly baseline.
  valueString: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "OID Value (raw)",
    "x-anomaly-enabled": false,
  }).optional(),
  // The SNMP type name or exception sentinel (noSuchObject / noSuchInstance /
  // endOfMibView). A completed response - assertable, not a failure.
  valueType: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "SNMP Type",
    "x-anomaly-enabled": false,
  }),
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
    "x-chart-good-direction": "down",
    "x-chart-priority": 20,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

export type SnmpResult = z.infer<typeof snmpResultSchema>;

// ============================================================================
// AGGREGATED RESULT (shared by strategy + collector)
// ============================================================================

export const snmpAggregatedFields = {
  avgValue: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg OID Value",
    "x-chart-priority": 10,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "deviation",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
  }),
  avgResponseTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
    "x-chart-priority": 20,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  // Count of runs in the bucket that hit a transport failure. Clear direction,
  // debounced with a confirmation window and a small absolute floor so a single
  // transient failure does not alert.
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    "x-chart-priority": 90,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 1,
  }),
};

export type SnmpAggregatedResult = InferAggregatedResult<
  typeof snmpAggregatedFields
>;

/** Shared VersionedAggregated so strategy and collector agree by construction. */
export function createSnmpAggregatedResult() {
  return new VersionedAggregated({ version: 1, fields: snmpAggregatedFields });
}

/**
 * Incrementally merge one run into the aggregated bucket. Shared by the strategy
 * and the collector so the two never drift.
 */
export function mergeSnmpAggregated(
  existing: SnmpAggregatedResult | undefined,
  run: HealthCheckRunForAggregation<SnmpResult>,
): SnmpAggregatedResult {
  const metadata = run.metadata;

  return {
    avgValue: mergeAverage(existing?.avgValue, metadata?.value),
    avgResponseTime: mergeAverage(
      existing?.avgResponseTime,
      metadata?.responseTimeMs,
    ),
    errorCount: mergeCounter(existing?.errorCount, metadata?.error !== undefined),
  };
}
