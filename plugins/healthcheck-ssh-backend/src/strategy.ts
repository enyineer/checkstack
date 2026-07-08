import { Client } from "ssh2";
import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedMinMax,
  aggregatedRate,
  aggregatedCounter,
  mergeAverage,
  mergeRate,
  mergeCounter,
  mergeMinMax,
  z,
  configString,
  configSecret,
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
import type { SshTransportClient, SshCommandResult } from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for SSH health checks.
 */
export const sshConfigSchema = baseStrategyConfigSchema.extend({
  // Templatable connection fields: support `{{ environment.host }}` etc. so one
  // config covers N environments. Presence is enforced POST-RENDER in
  // `createClient`. The auth secrets stay `configSecret` (never templatable).
  host: configString({ "x-templatable": true }).describe(
    "SSH server hostname. Supports templating, e.g. {{ environment.host }}",
  ),
  port: z.number().int().min(1).max(65_535).default(22).describe("SSH port"),
  username: configString({ "x-templatable": true }).describe(
    "SSH username. Supports templating, e.g. {{ environment.user }}",
  ),
  password: configSecret({ id: "password" })
    .describe("Password for authentication")
    .optional(),
  privateKey: configSecret({ id: "privateKey" })
    .describe("Private key for authentication")
    .optional(),
  passphrase: configSecret({ id: "passphrase" })
    .describe("Passphrase for private key")
    .optional(),
});

export type SshConfig = z.infer<typeof sshConfigSchema>;
export type SshConfigInput = z.input<typeof sshConfigSchema>;

/**
 * Post-render validator for required connection fields. The stored values are
 * plain templatable strings, so presence cannot be checked at store time; the
 * executor renders `{{ environment.* }}` per environment, then this rejects a
 * render that collapsed to empty/whitespace. An empty host/username is a config
 * error that prevents the probe - transport-failure semantics.
 */
const renderedRequiredSchema = z.string().trim().min(1);

/**
 * Per-run result metadata.
 */
const sshResultSchema = healthResultSchema({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
    "x-chart-true-label": "connected",
    "x-chart-false-label": "disconnected",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-chart-priority": 20,
    "x-chart-good-direction": "up",
  }),
  connectionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type SshResult = z.infer<typeof sshResultSchema>;

/** Aggregated field definitions for bucket merging */
const sshAggregatedFields = {
  avgConnectionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    // Latency: err wider and require a sustained, practically-significant
    // slowdown so small jitter never alerts.
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  maxConnectionTime: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Connection Time",
    "x-chart-unit": "ms",
    // A per-bucket max is the most outlier-sensitive aggregate: a single slow
    // run drives it, so baselining it produces noisy alerts. The average twin
    // already covers sustained latency regressions, so keep this off by default
    // (still chartable for tail-latency inspection).
    "x-anomaly-enabled": false,
    "x-chart-priority": 30,
    "x-chart-good-direction": "down",
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    // Availability percent: confirm a sustained drop and require a few percent
    // of real movement before alerting.
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
    "x-chart-priority": 20,
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    // Disabled by default: an absolute error count per bucket scales with the
    // number of samples in the bucket, so its baseline drifts with traffic
    // volume rather than with a real problem. Availability is already covered
    // by successRate (the percent form), so prefer that and keep this off.
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
    "x-chart-good-direction": "down",
  }),
};

type SshAggregatedResult = InferAggregatedResult<typeof sshAggregatedFields>;

// ============================================================================
// SSH CLIENT INTERFACE (for testability)
// ============================================================================

export interface SshConnection {
  exec(command: string): Promise<SshCommandResult>;
  end(): void;
}

export interface SshClient {
  connect(config: {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    readyTimeout: number;
  }): Promise<SshConnection>;
}

// Default client using ssh2
const defaultSshClient: SshClient = {
  connect(config) {
    return new Promise((resolve, reject) => {
      const client = new Client();

      client.on("ready", () => {
        resolve({
          exec(command: string): Promise<SshCommandResult> {
            return new Promise((execResolve, execReject) => {
              client.exec(command, (err, stream) => {
                if (err) {
                  execReject(err);
                  return;
                }

                let stdout = "";
                let stderr = "";

                stream.on("data", (data: Buffer) => {
                  stdout += data.toString();
                });

                stream.stderr.on("data", (data: Buffer) => {
                  stderr += data.toString();
                });

                stream.on("close", (code: number | null) => {
                  execResolve({
                    exitCode: code ?? 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                  });
                });

                stream.on("error", execReject);
              });
            });
          },
          end() {
            client.end();
          },
        });
      });

      client.on("error", reject);

      client.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        privateKey: config.privateKey,
        passphrase: config.passphrase,
        readyTimeout: config.readyTimeout,
      });
    });
  },
};

// ============================================================================
// STRATEGY
// ============================================================================

export class SshHealthCheckStrategy implements HealthCheckStrategy<
  SshConfig,
  SshTransportClient,
  SshResult,
  typeof sshAggregatedFields
> {
  id = "ssh";
  displayName = "SSH Health Check";
  description = "SSH server connectivity and command execution health check";
  category = StrategyCategory.INFRASTRUCTURE;

  private sshClient: SshClient;

  constructor(sshClient: SshClient = defaultSshClient) {
    this.sshClient = sshClient;
  }

  config: Versioned<SshConfig> = new Versioned({
    version: 1,
    schema: sshConfigSchema,
  });

  result: Versioned<SshResult> = new Versioned({
    version: 1,
    schema: sshResultSchema,
  });

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: sshAggregatedFields,
  });

  mergeResult(
    existing: SshAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<SshResult>,
  ): SshAggregatedResult {
    const metadata = run.metadata;

    const avgConnectionTime = mergeAverage(
      existing?.avgConnectionTime,
      metadata?.connectionTimeMs,
    );

    const maxConnectionTime = mergeMinMax(
      existing?.maxConnectionTime,
      metadata?.connectionTimeMs,
    );

    const isSuccess = metadata?.connected ?? false;
    const successRate = mergeRate(existing?.successRate, isSuccess);

    const hasError = metadata?.error !== undefined;
    const errorCount = mergeCounter(existing?.errorCount, hasError);

    return { avgConnectionTime, maxConnectionTime, successRate, errorCount };
  }

  /**
   * Create a connected SSH transport client.
   */
  async createClient(
    config: SshConfigInput,
  ): Promise<ConnectedClient<SshTransportClient>> {
    const validatedConfig = this.config.validate(config);

    // Post-render guard: `host`/`username` are templatable strings, so their
    // presence cannot be checked at store time. The executor has already
    // rendered `{{ environment.* }}`; reject a render that collapsed to empty so
    // the run fails clearly instead of attempting an empty connection.
    const rendered = z
      .object({ host: renderedRequiredSchema, username: renderedRequiredSchema })
      .safeParse({
        host: validatedConfig.host,
        username: validatedConfig.username,
      });
    if (!rendered.success) {
      throw new Error(
        `Rendered SSH connection fields are empty (host/username). ` +
          `Check the {{ environment.* }} templating for this environment.`,
      );
    }

    // The SSH handshake (TCP connect + auth + channel ready) is a single
    // measurable phase up front; record it as connectMs. The per-command exec
    // time is filled in below as processingMs (last-command-wins).
    const connectStart = performance.now();
    const connection = await this.sshClient.connect({
      host: rendered.data.host,
      port: validatedConfig.port,
      username: rendered.data.username,
      password: validatedConfig.password,
      privateKey: validatedConfig.privateKey,
      passphrase: validatedConfig.passphrase,
      readyTimeout: validatedConfig.timeout,
    });
    const timings: TransportTimings = {
      connectMs: Math.max(0, Math.round(performance.now() - connectStart)),
    };

    return {
      client: {
        exec: async (command: string): Promise<SshCommandResult> => {
          const start = performance.now();
          const result = await connection.exec(command);
          timings.processingMs = Math.max(
            0,
            Math.round(performance.now() - start),
          );
          return result;
        },
      },
      timings,
      close: () => connection.end(),
    };
  }
}
