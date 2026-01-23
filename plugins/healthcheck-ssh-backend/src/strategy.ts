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
  configNumber,
  type ConnectedClient,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import type { SshTransportClient, SshCommandResult } from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for SSH health checks.
 */
export const sshConfigSchema = z.object({
  host: z.string().describe("SSH server hostname"),
  port: z.number().int().min(1).max(65_535).default(22).describe("SSH port"),
  username: z.string().describe("SSH username"),
  password: configString({ "x-secret": true })
    .describe("Password for authentication")
    .optional(),
  privateKey: configString({ "x-secret": true })
    .describe("Private key for authentication")
    .optional(),
  passphrase: configString({ "x-secret": true })
    .describe("Passphrase for private key")
    .optional(),
  timeout: configNumber({})
    .min(100)
    .default(10_000)
    .describe("Connection timeout in milliseconds"),
});

export type SshConfig = z.infer<typeof sshConfigSchema>;
export type SshConfigInput = z.input<typeof sshConfigSchema>;

/**
 * Per-run result metadata.
 */
const sshResultSchema = healthResultSchema({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  connectionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

type SshResult = z.infer<typeof sshResultSchema>;

/** Aggregated field definitions for bucket merging */
const sshAggregatedFields = {
  avgConnectionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  maxConnectionTime: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Connection Time",
    "x-chart-unit": "ms",
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
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

    const connection = await this.sshClient.connect({
      host: validatedConfig.host,
      port: validatedConfig.port,
      username: validatedConfig.username,
      password: validatedConfig.password,
      privateKey: validatedConfig.privateKey,
      passphrase: validatedConfig.passphrase,
      readyTimeout: validatedConfig.timeout,
    });

    return {
      client: {
        exec: (command: string) => connection.exec(command),
      },
      close: () => connection.end(),
    };
  }
}
