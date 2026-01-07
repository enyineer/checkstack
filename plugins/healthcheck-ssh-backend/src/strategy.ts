import { Client } from "ssh2";
import {
  HealthCheckStrategy,
  HealthCheckResult,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  timeThresholdField,
  numericField,
  booleanField,
  stringField,
  evaluateAssertions,
  secret,
} from "@checkmate-monitor/backend-api";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Assertion schema for SSH health checks using shared factories.
 */
const sshAssertionSchema = z.discriminatedUnion("field", [
  timeThresholdField("connectionTime"),
  timeThresholdField("commandTime"),
  numericField("exitCode", { min: 0 }),
  booleanField("commandSuccess"),
  stringField("stdout"),
]);

export type SshAssertion = z.infer<typeof sshAssertionSchema>;

/**
 * Configuration schema for SSH health checks.
 */
export const sshConfigSchema = z.object({
  host: z.string().describe("SSH server hostname"),
  port: z.number().int().min(1).max(65_535).default(22).describe("SSH port"),
  username: z.string().describe("SSH username"),
  password: secret({ description: "Password for authentication" }).optional(),
  privateKey: secret({
    description: "Private key for authentication",
  }).optional(),
  passphrase: secret({ description: "Passphrase for private key" }).optional(),
  timeout: z
    .number()
    .min(100)
    .default(10_000)
    .describe("Connection timeout in milliseconds"),
  command: z
    .string()
    .optional()
    .describe("Command to execute for health check (optional)"),
  assertions: z
    .array(sshAssertionSchema)
    .optional()
    .describe("Validation conditions"),
});

export type SshConfig = z.infer<typeof sshConfigSchema>;
export type SshConfigInput = z.input<typeof sshConfigSchema>;

/**
 * Per-run result metadata.
 */
const sshResultSchema = z.object({
  connected: z.boolean().meta({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  connectionTimeMs: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
  }),
  commandTimeMs: z.number().optional().meta({
    "x-chart-type": "line",
    "x-chart-label": "Command Time",
    "x-chart-unit": "ms",
  }),
  exitCode: z.number().optional().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Exit Code",
  }),
  stdout: z.string().optional().meta({
    "x-chart-type": "text",
    "x-chart-label": "Stdout",
  }),
  stderr: z.string().optional().meta({
    "x-chart-type": "text",
    "x-chart-label": "Stderr",
  }),
  commandSuccess: z.boolean().meta({
    "x-chart-type": "boolean",
    "x-chart-label": "Command Success",
  }),
  failedAssertion: sshAssertionSchema.optional(),
  error: z.string().optional().meta({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }),
});

export type SshResult = z.infer<typeof sshResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const sshAggregatedSchema = z.object({
  avgConnectionTime: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  avgCommandTime: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Avg Command Time",
    "x-chart-unit": "ms",
  }),
  successRate: z.number().meta({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: z.number().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
});

export type SshAggregatedResult = z.infer<typeof sshAggregatedSchema>;

// ============================================================================
// SSH CLIENT INTERFACE (for testability)
// ============================================================================

export interface SshCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

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

export class SshHealthCheckStrategy
  implements HealthCheckStrategy<SshConfig, SshResult, SshAggregatedResult>
{
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

  aggregatedResult: Versioned<SshAggregatedResult> = new Versioned({
    version: 1,
    schema: sshAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<SshResult>[]
  ): SshAggregatedResult {
    let totalConnectionTime = 0;
    let totalCommandTime = 0;
    let successCount = 0;
    let errorCount = 0;
    let validRuns = 0;
    let commandRuns = 0;

    for (const run of runs) {
      if (run.metadata?.error) {
        errorCount++;
        continue;
      }
      if (run.status === "healthy") {
        successCount++;
      }
      if (run.metadata) {
        totalConnectionTime += run.metadata.connectionTimeMs;
        if (run.metadata.commandTimeMs !== undefined) {
          totalCommandTime += run.metadata.commandTimeMs;
          commandRuns++;
        }
        validRuns++;
      }
    }

    return {
      avgConnectionTime: validRuns > 0 ? totalConnectionTime / validRuns : 0,
      avgCommandTime: commandRuns > 0 ? totalCommandTime / commandRuns : 0,
      successRate: runs.length > 0 ? (successCount / runs.length) * 100 : 0,
      errorCount,
    };
  }

  async execute(config: SshConfigInput): Promise<HealthCheckResult<SshResult>> {
    const validatedConfig = this.config.validate(config);
    const start = performance.now();

    try {
      // Connect to SSH server
      const connection = await this.sshClient.connect({
        host: validatedConfig.host,
        port: validatedConfig.port,
        username: validatedConfig.username,
        password: validatedConfig.password,
        privateKey: validatedConfig.privateKey,
        passphrase: validatedConfig.passphrase,
        readyTimeout: validatedConfig.timeout,
      });

      const connectionTimeMs = Math.round(performance.now() - start);

      let commandTimeMs: number | undefined;
      let exitCode: number | undefined;
      let stdout: string | undefined;
      let stderr: string | undefined;
      let commandSuccess = true;

      // Execute command if provided
      if (validatedConfig.command) {
        const commandStart = performance.now();
        try {
          const result = await connection.exec(validatedConfig.command);
          exitCode = result.exitCode;
          stdout = result.stdout;
          stderr = result.stderr;
          commandSuccess = result.exitCode === 0;
          commandTimeMs = Math.round(performance.now() - commandStart);
        } catch {
          commandSuccess = false;
          commandTimeMs = Math.round(performance.now() - commandStart);
        }
      }

      connection.end();

      const result: Omit<SshResult, "failedAssertion" | "error"> = {
        connected: true,
        connectionTimeMs,
        commandTimeMs,
        exitCode,
        stdout,
        stderr,
        commandSuccess,
      };

      // Evaluate assertions using shared utility
      const failedAssertion = evaluateAssertions(validatedConfig.assertions, {
        connectionTime: connectionTimeMs,
        commandTime: commandTimeMs ?? 0,
        exitCode: exitCode ?? 0,
        commandSuccess,
        stdout: stdout ?? "",
      });

      if (failedAssertion) {
        return {
          status: "unhealthy",
          latencyMs: connectionTimeMs + (commandTimeMs ?? 0),
          message: `Assertion failed: ${failedAssertion.field} ${
            failedAssertion.operator
          }${"value" in failedAssertion ? ` ${failedAssertion.value}` : ""}`,
          metadata: { ...result, failedAssertion },
        };
      }

      if (!commandSuccess && validatedConfig.command) {
        return {
          status: "unhealthy",
          latencyMs: connectionTimeMs + (commandTimeMs ?? 0),
          message: `Command failed with exit code ${exitCode}`,
          metadata: result,
        };
      }

      const message = validatedConfig.command
        ? `SSH connected, command executed (exit ${exitCode}) in ${commandTimeMs}ms`
        : `SSH connected in ${connectionTimeMs}ms`;

      return {
        status: "healthy",
        latencyMs: connectionTimeMs + (commandTimeMs ?? 0),
        message,
        metadata: result,
      };
    } catch (error: unknown) {
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latencyMs: Math.round(end - start),
        message: isError ? error.message : "SSH connection failed",
        metadata: {
          connected: false,
          connectionTimeMs: Math.round(end - start),
          commandSuccess: false,
          error: isError ? error.name : "UnknownError",
        },
      };
    }
  }
}
