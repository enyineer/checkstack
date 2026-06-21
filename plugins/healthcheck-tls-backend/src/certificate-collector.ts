import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  mergeRate,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { TlsTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const certificateConfigSchema = z.object({
  // No config needed - just returns cert info from connection
});

export type CertificateConfig = z.infer<typeof certificateConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const certificateResultSchema = healthResultSchema({
  subject: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Subject",
    "x-anomaly-enabled": false,
  }),
  issuer: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Issuer",
    "x-anomaly-enabled": false,
  }),
  validFrom: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Valid From",
    "x-anomaly-enabled": false,
  }),
  validTo: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Valid To",
    "x-anomaly-enabled": false,
  }),
  // Certificate days-remaining decreases by exactly one per day - a
  // deterministic, monotonic value. A learned baseline (mu +/- N sigma) is the
  // wrong tool for it: the "anomaly" is simply "below ~30 days", which is a
  // static health threshold (config: minDaysUntilExpiry), not a statistical
  // outlier. Leave it chartable but off by default so it never produces
  // baseline-driven noise; expiry is enforced by the static threshold instead.
  daysRemaining: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Days Remaining",
    "x-chart-unit": "days",
    "x-anomaly-enabled": false,
  }),
  // Certificate validity is an availability-style signal: a flip from valid to
  // invalid is a genuine, impactful problem. Debounce so a single transient
  // probe failure does not alert on its own.
  valid: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Valid",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-anomaly-confirmation-window": 3,
  }),
});

export type CertificateResult = z.infer<typeof certificateResultSchema>;

// Aggregated result fields definition
const certificateAggregatedFields = {
  // Average days-remaining inherits the same deterministic, monotonic decay as
  // the per-run value, so a learned baseline is meaningless here. Off by
  // default; expiry is governed by the static minDaysUntilExpiry threshold.
  avgDaysRemaining: aggregatedAverage({
    "x-chart-type": "gauge",
    "x-chart-label": "Avg Days Remaining",
    "x-chart-unit": "days",
    "x-anomaly-enabled": false,
  }),
  // Fraction of probes returning a valid certificate. A drop is a real
  // availability/validity problem. Debounce and require a meaningful drop
  // (a few percent) before alerting so small sampling jitter stays quiet.
  validRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Valid Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
  }),
};

// Type inferred from field definitions
export type CertificateAggregatedResult = InferAggregatedResult<
  typeof certificateAggregatedFields
>;

// ============================================================================
// CERTIFICATE COLLECTOR
// ============================================================================

/**
 * Built-in TLS certificate collector.
 * Returns certificate information from the TLS connection.
 */
export class CertificateCollector implements CollectorStrategy<
  TlsTransportClient,
  CertificateConfig,
  CertificateResult,
  CertificateAggregatedResult
> {
  id = "certificate";
  displayName = "TLS Certificate";
  description = "Check TLS certificate validity and expiration";

  supportedPlugins = [pluginMetadata];

  allowMultiple = false;

  config = new Versioned({ version: 1, schema: certificateConfigSchema });
  result = new Versioned({ version: 1, schema: certificateResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: certificateAggregatedFields,
  });

  async execute({
    client,
  }: {
    config: CertificateConfig;
    client: TlsTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<CertificateResult>> {
    const response = await client.exec({ action: "inspect" });

    if (response.error) {
      return {
        result: {
          subject: "",
          issuer: "",
          validFrom: "",
          validTo: "",
          daysRemaining: 0,
          valid: false,
        },
        error: response.error,
      };
    }

    return {
      result: {
        subject: response.subject ?? "",
        issuer: response.issuer ?? "",
        validFrom: response.validFrom ?? "",
        validTo: response.validTo ?? "",
        daysRemaining: response.daysRemaining ?? 0,
        valid: (response.daysRemaining ?? 0) > 0,
      },
    };
  }

  mergeResult(
    existing: CertificateAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<CertificateResult>,
  ): CertificateAggregatedResult {
    const metadata = run.metadata;

    return {
      avgDaysRemaining: mergeAverage(
        existing?.avgDaysRemaining,
        metadata?.daysRemaining,
      ),
      validRate: mergeRate(existing?.validRate, metadata?.valid),
    };
  }
}
