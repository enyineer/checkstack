import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
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
  }),
  issuer: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Issuer",
  }),
  validFrom: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Valid From",
  }),
  validTo: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Valid To",
  }),
  daysRemaining: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Days Remaining",
    "x-chart-unit": "days",
  }),
  valid: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Valid",
  }),
});

export type CertificateResult = z.infer<typeof certificateResultSchema>;

const certificateAggregatedSchema = healthResultSchema({
  avgDaysRemaining: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Avg Days Remaining",
    "x-chart-unit": "days",
  }),
  validRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Valid Rate",
    "x-chart-unit": "%",
  }),
});

export type CertificateAggregatedResult = z.infer<
  typeof certificateAggregatedSchema
>;

// ============================================================================
// CERTIFICATE COLLECTOR
// ============================================================================

/**
 * Built-in TLS certificate collector.
 * Returns certificate information from the TLS connection.
 */
export class CertificateCollector
  implements
    CollectorStrategy<
      TlsTransportClient,
      CertificateConfig,
      CertificateResult,
      CertificateAggregatedResult
    >
{
  id = "certificate";
  displayName = "TLS Certificate";
  description = "Check TLS certificate validity and expiration";

  supportedPlugins = [pluginMetadata];

  allowMultiple = false;

  config = new Versioned({ version: 1, schema: certificateConfigSchema });
  result = new Versioned({ version: 1, schema: certificateResultSchema });
  aggregatedResult = new Versioned({
    version: 1,
    schema: certificateAggregatedSchema,
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

  aggregateResult(
    runs: HealthCheckRunForAggregation<CertificateResult>[]
  ): CertificateAggregatedResult {
    const daysRemaining = runs
      .map((r) => r.metadata?.daysRemaining)
      .filter((v): v is number => typeof v === "number");

    const validResults = runs
      .map((r) => r.metadata?.valid)
      .filter((v): v is boolean => typeof v === "boolean");

    const validCount = validResults.filter(Boolean).length;

    return {
      avgDaysRemaining:
        daysRemaining.length > 0
          ? Math.round(
              daysRemaining.reduce((a, b) => a + b, 0) / daysRemaining.length
            )
          : 0,
      validRate:
        validResults.length > 0
          ? Math.round((validCount / validResults.length) * 100)
          : 0,
    };
  }
}
