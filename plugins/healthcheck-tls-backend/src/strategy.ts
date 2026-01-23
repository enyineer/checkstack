import * as tls from "node:tls";
import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedMinMax,
  aggregatedCounter,
  mergeAverage,
  mergeCounter,
  mergeMinMax,
  z,
  type ConnectedClient,
  type InferAggregatedResult,
  baseStrategyConfigSchema,
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import type {
  TlsTransportClient,
  TlsInspectRequest,
  TlsCertificateInfo,
} from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for TLS health checks.
 */
export const tlsConfigSchema = baseStrategyConfigSchema.extend({
  host: z.string().describe("Hostname to connect to"),
  port: z.number().int().min(1).max(65_535).default(443).describe("TLS port"),
  servername: z
    .string()
    .optional()
    .describe("Server name for SNI (defaults to host)"),
  minDaysUntilExpiry: z
    .number()
    .int()
    .min(0)
    .default(30)
    .describe("Minimum days before certificate expiry to consider healthy"),
  rejectUnauthorized: z
    .boolean()
    .default(true)
    .describe("Reject invalid/self-signed certificates"),
});

export type TlsConfig = z.infer<typeof tlsConfigSchema>;

/**
 * Per-run result metadata.
 */
const tlsResultSchema = healthResultSchema({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  isValid: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Valid",
  }),
  isSelfSigned: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Self-Signed",
  }),
  daysUntilExpiry: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Days Until Expiry",
    "x-chart-unit": "days",
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

type TlsResult = z.infer<typeof tlsResultSchema>;

/** Aggregated field definitions for bucket merging */
const tlsAggregatedFields = {
  avgDaysUntilExpiry: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Days Until Expiry",
    "x-chart-unit": "days",
  }),
  minDaysUntilExpiry: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Min Days Until Expiry",
    "x-chart-unit": "days",
  }),
  invalidCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Invalid Certificates",
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
};

type TlsAggregatedResult = InferAggregatedResult<typeof tlsAggregatedFields>;

// ============================================================================
// TLS CLIENT INTERFACE (for testability)
// ============================================================================

export interface CertificateInfo {
  subject: { CN?: string };
  issuer: { CN?: string; O?: string };
  valid_from: string;
  valid_to: string;
}

export interface TlsConnection {
  authorized: boolean;
  getPeerCertificate(): CertificateInfo;
  getProtocol(): string | null;
  getCipher(): { name: string } | null;
  end(): void;
}

export interface TlsClient {
  connect(options: {
    host: string;
    port: number;
    servername: string;
    rejectUnauthorized: boolean;
    timeout: number;
  }): Promise<TlsConnection>;
}

// Default client using Node.js tls module
const defaultTlsClient: TlsClient = {
  connect(options): Promise<TlsConnection> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: options.host,
          port: options.port,
          servername: options.servername,
          rejectUnauthorized: options.rejectUnauthorized,
          timeout: options.timeout,
        },
        () => {
          resolve({
            authorized: socket.authorized,
            getPeerCertificate: () =>
              socket.getPeerCertificate() as unknown as CertificateInfo,
            getProtocol: () => socket.getProtocol(),
            getCipher: () => socket.getCipher(),
            end: () => socket.end(),
          });
        },
      );

      socket.on("error", reject);
      socket.setTimeout(options.timeout, () => {
        socket.destroy();
        reject(new Error("Connection timeout"));
      });
    });
  },
};

// ============================================================================
// STRATEGY
// ============================================================================

export class TlsHealthCheckStrategy implements HealthCheckStrategy<
  TlsConfig,
  TlsTransportClient,
  TlsResult,
  typeof tlsAggregatedFields
> {
  id = "tls";
  displayName = "TLS/SSL Health Check";
  description = "SSL/TLS certificate validation and expiry monitoring";

  private tlsClient: TlsClient;

  constructor(tlsClient: TlsClient = defaultTlsClient) {
    this.tlsClient = tlsClient;
  }

  config: Versioned<TlsConfig> = new Versioned({
    version: 2, // Bumped for createClient pattern
    schema: tlsConfigSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no config changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  result: Versioned<TlsResult> = new Versioned({
    version: 2,
    schema: tlsResultSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no result changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: tlsAggregatedFields,
  });

  mergeResult(
    existing: TlsAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<TlsResult>,
  ): TlsAggregatedResult {
    const metadata = run.metadata;

    const avgDaysUntilExpiry = mergeAverage(
      existing?.avgDaysUntilExpiry,
      metadata?.daysUntilExpiry,
    );

    const minDaysUntilExpiry = mergeMinMax(
      existing?.minDaysUntilExpiry,
      metadata?.daysUntilExpiry,
    );

    const isInvalid = metadata?.isValid === false;
    const invalidCount = mergeCounter(existing?.invalidCount, isInvalid);

    const hasError = metadata?.error !== undefined;
    const errorCount = mergeCounter(existing?.errorCount, hasError);

    return { avgDaysUntilExpiry, minDaysUntilExpiry, invalidCount, errorCount };
  }

  async createClient(
    config: TlsConfig,
  ): Promise<ConnectedClient<TlsTransportClient>> {
    const validatedConfig = this.config.validate(config);

    const connection = await this.tlsClient.connect({
      host: validatedConfig.host,
      port: validatedConfig.port,
      servername: validatedConfig.servername ?? validatedConfig.host,
      rejectUnauthorized: validatedConfig.rejectUnauthorized,
      timeout: validatedConfig.timeout,
    });

    const cert = connection.getPeerCertificate();
    const validTo = new Date(cert.valid_to);
    const daysUntilExpiry = Math.floor(
      (validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );

    const certInfo: TlsCertificateInfo = {
      isValid: connection.authorized,
      isSelfSigned: cert.issuer?.CN === cert.subject?.CN,
      issuer: cert.issuer?.O || cert.issuer?.CN || "Unknown",
      subject: cert.subject?.CN || "Unknown",
      validFrom: cert.valid_from,
      validTo: cert.valid_to,
      daysUntilExpiry,
      daysRemaining: daysUntilExpiry,
      protocol: connection.getProtocol() ?? undefined,
      cipher: connection.getCipher()?.name,
    };

    const client: TlsTransportClient = {
      async exec(_request: TlsInspectRequest): Promise<TlsCertificateInfo> {
        // Certificate info is captured at connection time
        return certInfo;
      },
    };

    return {
      client,
      close: () => connection.end(),
    };
  }
}
