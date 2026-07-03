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
  type TransportTimings,
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
    "x-chart-true-label": "connected",
    "x-chart-false-label": "disconnected",
    "x-chart-priority": 20,
    "x-chart-good-direction": "up",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-anomaly-confirmation-window": 3,
  }),
  // Certificate validity is availability-style: a flip to invalid is a genuine
  // problem. Debounce against transient probe noise.
  isValid: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Valid",
    "x-chart-true-label": "valid",
    "x-chart-false-label": "invalid",
    "x-chart-priority": 30,
    "x-chart-good-direction": "up",
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
    "x-chart-true-label": "self-signed",
    "x-chart-false-label": "CA-signed",
    "x-chart-priority": 40,
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
    "x-chart-priority": 10,
    "x-chart-good-direction": "up",
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
    "x-chart-priority": 10,
    "x-chart-good-direction": "up",
    "x-anomaly-enabled": false,
  }),
  // Minimum days-until-expiry is likewise deterministic and monotonic; a
  // baseline does not apply. Off by default, still chartable.
  minDaysUntilExpiry: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Min Days Until Expiry",
    "x-chart-unit": "days",
    "x-chart-priority": 20,
    "x-chart-good-direction": "up",
    "x-anomaly-enabled": false,
  }),
  // Count of invalid certificates per bucket. A rise is a real validity
  // problem. Debounce so a single bucket blip does not alert.
  invalidCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Invalid Certificates",
    "x-chart-priority": 30,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-confirmation-window": 3,
  }),
  // Count of connection/inspection errors per bucket. A rise is a real
  // availability problem. Debounce against transient blips.
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    "x-chart-priority": 40,
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

/**
 * A connection plus its measured phase timings. `connectMs` is the TCP connect
 * (socket `connect` event) and `tlsMs` is the TLS handshake (between TCP connect
 * and the secure-connect callback). Either may be undefined when the underlying
 * client cannot measure it (e.g. an injected test double).
 */
export interface TimedTlsConnection {
  connection: TlsConnection;
  connectMs?: number;
  tlsMs?: number;
}

export interface TlsClient {
  connect(options: {
    host: string;
    port: number;
    servername: string;
    rejectUnauthorized: boolean;
    timeout: number;
  }): Promise<TimedTlsConnection>;
}

// Default client using Node.js tls module
const defaultTlsClient: TlsClient = {
  connect(options): Promise<TimedTlsConnection> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      let tcpConnectedAt: number | undefined;
      const socket = tls.connect(
        {
          host: options.host,
          port: options.port,
          servername: options.servername,
          rejectUnauthorized: options.rejectUnauthorized,
          timeout: options.timeout,
        },
        () => {
          const secureAt = performance.now();
          resolve({
            connection: {
              authorized: socket.authorized,
              getPeerCertificate: () =>
                socket.getPeerCertificate() as unknown as CertificateInfo,
              getProtocol: () => socket.getProtocol(),
              getCipher: () => socket.getCipher(),
              end: () => socket.end(),
            },
            // TCP connect: socket `connect` to first byte of the handshake.
            connectMs:
              tcpConnectedAt === undefined
                ? undefined
                : Math.max(0, tcpConnectedAt - start),
            // TLS handshake: TCP connect to the secure-connect callback. When
            // the `connect` event did not fire (already-connected socket), fall
            // back to measuring the whole connect as handshake.
            tlsMs: Math.max(0, secureAt - (tcpConnectedAt ?? start)),
          });
        },
      );

      socket.on("connect", () => {
        tcpConnectedAt = performance.now();
      });

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

    const { connection, connectMs, tlsMs } = await this.tlsClient.connect({
      host: validatedConfig.host,
      port: validatedConfig.port,
      servername: validatedConfig.servername ?? validatedConfig.host,
      rejectUnauthorized: validatedConfig.rejectUnauthorized,
      timeout: validatedConfig.timeout,
    });

    // Surface the measured TCP connect + TLS handshake phases to the executor.
    const timings: TransportTimings = {};
    if (connectMs !== undefined) timings.connectMs = connectMs;
    if (tlsMs !== undefined) timings.tlsMs = tlsMs;

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
      timings,
      close: () => connection.end(),
    };
  }
}
