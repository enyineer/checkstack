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
  StrategyCategory,
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
  // Connection success is an availability signal. Debounce so a single
  // transient connect failure does not alert on its own.
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-anomaly-confirmation-window": 3,
  }),
  // Certificate validity is availability-style: a flip to invalid is a genuine
  // problem. Debounce against transient probe noise.
  isValid: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Valid",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-anomaly-confirmation-window": 3,
  }),
  // Self-signed is effectively a constant property of the endpoint's
  // configuration: it does not legitimately flip run-to-run, so a learned
  // dominance baseline cannot produce a meaningful default. A real flip
  // (e.g. a swapped cert) already surfaces through isValid. Off by default to
  // avoid baselining a constant; still chartable and opt-in.
  isSelfSigned: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Self-Signed",
    "x-anomaly-enabled": false,
  }),
  // Days-until-expiry decreases by exactly one per day - deterministic and
  // monotonic, so a learned baseline is the wrong fit. Expiry is a static
  // threshold concern (config: minDaysUntilExpiry), not a statistical outlier.
  // Off by default; remains chartable.
  daysUntilExpiry: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Days Until Expiry",
    "x-chart-unit": "days",
    "x-anomaly-enabled": false,
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type TlsResult = z.infer<typeof tlsResultSchema>;

/** Aggregated field definitions for bucket merging */
const tlsAggregatedFields = {
  // Average days-until-expiry inherits the deterministic, monotonic decay of
  // the per-run value, so a learned baseline is meaningless. Off by default;
  // expiry is governed by the static minDaysUntilExpiry threshold.
  avgDaysUntilExpiry: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Days Until Expiry",
    "x-chart-unit": "days",
    "x-anomaly-enabled": false,
  }),
  // Minimum days-until-expiry is likewise deterministic and monotonic; a
  // baseline does not apply. Off by default, still chartable.
  minDaysUntilExpiry: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Min Days Until Expiry",
    "x-chart-unit": "days",
    "x-anomaly-enabled": false,
  }),
  // Count of invalid certificates per bucket. A rise is a real validity
  // problem. Debounce so a single bucket blip does not alert.
  invalidCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Invalid Certificates",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-confirmation-window": 3,
  }),
  // Count of connection/inspection errors per bucket. A rise is a real
  // availability problem. Debounce against transient blips.
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-confirmation-window": 3,
  }),
};

type TlsAggregatedResult = InferAggregatedResult<typeof tlsAggregatedFields>;

// ============================================================================
// TLS CLIENT INTERFACE (for testability)
// ============================================================================

/**
 * Raw `node:tls` peer-certificate shape used by the in-process TLS client
 * implementation. Exported only so the package's own tests can build mock
 * `TlsConnection`s; not part of the plugin's public surface. Use
 * [[TlsCertificateInfo]] from `./transport-client` for the transport contract.
 * @internal
 */
export interface CertificateInfo {
  subject: { CN?: string };
  issuer: { CN?: string; O?: string };
  valid_from: string;
  valid_to: string;
}

/** @internal */
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
  category = StrategyCategory.NETWORKING;

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
