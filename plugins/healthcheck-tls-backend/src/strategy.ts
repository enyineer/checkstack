import * as tls from "node:tls";
import {
  HealthCheckStrategy,
  HealthCheckResult,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  numericField,
  stringField,
  booleanField,
  evaluateAssertions,
} from "@checkmate-monitor/backend-api";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Assertion schema for TLS health checks using shared factories.
 */
const tlsAssertionSchema = z.discriminatedUnion("field", [
  numericField("daysUntilExpiry", { min: 0 }),
  stringField("issuer"),
  stringField("subject"),
  booleanField("isValid"),
  booleanField("isSelfSigned"),
]);

export type TlsAssertion = z.infer<typeof tlsAssertionSchema>;

/**
 * Configuration schema for TLS health checks.
 */
export const tlsConfigSchema = z.object({
  host: z.string().describe("Hostname to connect to"),
  port: z.number().int().min(1).max(65_535).default(443).describe("TLS port"),
  servername: z
    .string()
    .optional()
    .describe("SNI hostname (defaults to host if not specified)"),
  timeout: z
    .number()
    .min(100)
    .default(10_000)
    .describe("Connection timeout in milliseconds"),
  minDaysUntilExpiry: z
    .number()
    .min(0)
    .default(14)
    .describe("Minimum days until certificate expiry for healthy status"),
  rejectUnauthorized: z
    .boolean()
    .default(true)
    .describe("Reject invalid/self-signed certificates"),
  assertions: z
    .array(tlsAssertionSchema)
    .optional()
    .describe("Validation conditions"),
});

export type TlsConfig = z.infer<typeof tlsConfigSchema>;

/**
 * Per-run result metadata.
 */
const tlsResultSchema = z.object({
  connected: z.boolean().meta({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  isValid: z.boolean().meta({
    "x-chart-type": "boolean",
    "x-chart-label": "Certificate Valid",
  }),
  isSelfSigned: z.boolean().meta({
    "x-chart-type": "boolean",
    "x-chart-label": "Self-Signed",
  }),
  issuer: z.string().meta({
    "x-chart-type": "text",
    "x-chart-label": "Issuer",
  }),
  subject: z.string().meta({
    "x-chart-type": "text",
    "x-chart-label": "Subject",
  }),
  validFrom: z.string().meta({
    "x-chart-type": "text",
    "x-chart-label": "Valid From",
  }),
  validTo: z.string().meta({
    "x-chart-type": "text",
    "x-chart-label": "Valid To",
  }),
  daysUntilExpiry: z.number().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Days Until Expiry",
    "x-chart-unit": "days",
  }),
  protocol: z.string().optional().meta({
    "x-chart-type": "text",
    "x-chart-label": "Protocol",
  }),
  cipher: z.string().optional().meta({
    "x-chart-type": "text",
    "x-chart-label": "Cipher",
  }),
  failedAssertion: tlsAssertionSchema.optional(),
  error: z.string().optional().meta({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }),
});

export type TlsResult = z.infer<typeof tlsResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const tlsAggregatedSchema = z.object({
  avgDaysUntilExpiry: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Avg Days Until Expiry",
    "x-chart-unit": "days",
  }),
  minDaysUntilExpiry: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Min Days Until Expiry",
    "x-chart-unit": "days",
  }),
  invalidCount: z.number().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Invalid Certificates",
  }),
  errorCount: z.number().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
});

export type TlsAggregatedResult = z.infer<typeof tlsAggregatedSchema>;

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
        }
      );

      socket.on("error", reject);
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("Connection timeout"));
      });
    });
  },
};

// ============================================================================
// STRATEGY
// ============================================================================

export class TlsHealthCheckStrategy
  implements HealthCheckStrategy<TlsConfig, TlsResult, TlsAggregatedResult>
{
  id = "tls";
  displayName = "TLS/SSL Health Check";
  description = "SSL/TLS certificate validation and expiry monitoring";

  private tlsClient: TlsClient;

  constructor(tlsClient: TlsClient = defaultTlsClient) {
    this.tlsClient = tlsClient;
  }

  config: Versioned<TlsConfig> = new Versioned({
    version: 1,
    schema: tlsConfigSchema,
  });

  result: Versioned<TlsResult> = new Versioned({
    version: 1,
    schema: tlsResultSchema,
  });

  aggregatedResult: Versioned<TlsAggregatedResult> = new Versioned({
    version: 1,
    schema: tlsAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<TlsResult>[]
  ): TlsAggregatedResult {
    let totalDaysUntilExpiry = 0;
    let minDaysUntilExpiry = Number.POSITIVE_INFINITY;
    let invalidCount = 0;
    let errorCount = 0;
    let validRuns = 0;

    for (const run of runs) {
      if (run.metadata?.error) {
        errorCount++;
        continue;
      }
      if (run.metadata && !run.metadata.isValid) {
        invalidCount++;
      }
      if (run.metadata) {
        totalDaysUntilExpiry += run.metadata.daysUntilExpiry;
        if (run.metadata.daysUntilExpiry < minDaysUntilExpiry) {
          minDaysUntilExpiry = run.metadata.daysUntilExpiry;
        }
        validRuns++;
      }
    }

    return {
      avgDaysUntilExpiry: validRuns > 0 ? totalDaysUntilExpiry / validRuns : 0,
      minDaysUntilExpiry:
        minDaysUntilExpiry === Number.POSITIVE_INFINITY
          ? 0
          : minDaysUntilExpiry,
      invalidCount,
      errorCount,
    };
  }

  async execute(config: TlsConfig): Promise<HealthCheckResult<TlsResult>> {
    const validatedConfig = this.config.validate(config);
    const start = performance.now();

    try {
      const connection = await this.tlsClient.connect({
        host: validatedConfig.host,
        port: validatedConfig.port,
        servername: validatedConfig.servername ?? validatedConfig.host,
        rejectUnauthorized: validatedConfig.rejectUnauthorized,
        timeout: validatedConfig.timeout,
      });

      const cert = connection.getPeerCertificate();
      const protocol = connection.getProtocol();
      const cipher = connection.getCipher();

      connection.end();

      const end = performance.now();
      const latencyMs = Math.round(end - start);

      // Calculate days until expiry
      const validTo = new Date(cert.valid_to);
      const now = new Date();
      const daysUntilExpiry = Math.floor(
        (validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Determine if self-signed
      const isSelfSigned =
        cert.issuer.CN === cert.subject.CN && cert.issuer.O === undefined;

      const result: Omit<TlsResult, "failedAssertion" | "error"> = {
        connected: true,
        isValid: connection.authorized,
        isSelfSigned,
        issuer: cert.issuer.CN ?? cert.issuer.O ?? "Unknown",
        subject: cert.subject.CN ?? "Unknown",
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        daysUntilExpiry,
        protocol: protocol ?? undefined,
        cipher: cipher?.name,
      };

      // Evaluate assertions using shared utility
      const failedAssertion = evaluateAssertions(validatedConfig.assertions, {
        daysUntilExpiry,
        issuer: result.issuer,
        subject: result.subject,
        isValid: result.isValid,
        isSelfSigned,
      });

      if (failedAssertion) {
        return {
          status: "unhealthy",
          latencyMs,
          message: `Assertion failed: ${failedAssertion.field} ${
            failedAssertion.operator
          }${"value" in failedAssertion ? ` ${failedAssertion.value}` : ""}`,
          metadata: { ...result, failedAssertion },
        };
      }

      // Check minimum days until expiry
      if (daysUntilExpiry < validatedConfig.minDaysUntilExpiry) {
        return {
          status: "unhealthy",
          latencyMs,
          message: `Certificate expires in ${daysUntilExpiry} days (minimum: ${validatedConfig.minDaysUntilExpiry})`,
          metadata: result,
        };
      }

      // Check certificate validity
      if (!connection.authorized && validatedConfig.rejectUnauthorized) {
        return {
          status: "unhealthy",
          latencyMs,
          message: "Certificate is not valid or not trusted",
          metadata: result,
        };
      }

      return {
        status: "healthy",
        latencyMs,
        message: `Certificate valid for ${daysUntilExpiry} days (${result.subject} issued by ${result.issuer})`,
        metadata: result,
      };
    } catch (error: unknown) {
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latencyMs: Math.round(end - start),
        message: isError ? error.message : "TLS connection failed",
        metadata: {
          connected: false,
          isValid: false,
          isSelfSigned: false,
          issuer: "",
          subject: "",
          validFrom: "",
          validTo: "",
          daysUntilExpiry: 0,
          error: isError ? error.name : "UnknownError",
        },
      };
    }
  }
}
