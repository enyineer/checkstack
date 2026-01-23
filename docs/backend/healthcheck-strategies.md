---
---
# Health Check Strategy Development

## Overview

Health check strategies define **transport-level connectivity** to services. Each strategy establishes a connection and provides a transport client that collectors use to gather metrics.

**Key Concepts:**

| Component | Responsibility | Example |
|-----------|----------------|---------|
| **Strategy** | Establish connection, provide transport client | SSH strategy connects to server |
| **Collector** | Use transport client to gather metrics | CPU collector runs commands via SSH |

Strategies focus on **how to connect**; collectors define **what to collect**.

## The CreateClient Pattern

Strategies implement the `createClient()` method which:
1. Validates configuration
2. Establishes a connection to the target service
3. Returns a `ConnectedClient<TClient>` with a close method

The platform executor handles:
- Calling `createClient()` and measuring connection latency
- Passing the transport client to registered collectors
- Ensuring `close()` is called in a `finally` block

```typescript
export interface HealthCheckStrategy<
  TConfig,
  TClient extends TransportClient<unknown, unknown>,
  TResult,
  TAggregatedResult
> {
  id: string;
  displayName: string;
  description?: string;

  /** Configuration schema with versioning */
  config: Versioned<TConfig>;

  /** Optional per-run result schema */
  result?: Versioned<TResult>;

  /** Aggregated result schema for bucket storage */
  aggregatedResult: Versioned<TAggregatedResult>;

  /** Create a connected transport client */
  createClient(config: TConfig): Promise<ConnectedClient<TClient>>;

  /** Incrementally merge a new run into the aggregated result */
  mergeResult(
    existing: TAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<TResult>
  ): TAggregatedResult;
}
```

## Transport Clients

Each strategy provides a specific transport client interface:

| Strategy | Client Type | Command/Request | Result |
|----------|-------------|-----------------|--------|
| **SSH** | `SshTransportClient` | `string` (shell command) | `SshCommandResult` |
| **HTTP** | `HttpTransportClient` | `HttpRequest` | `HttpResponse` |
| **PostgreSQL** | `SqlTransportClient` | `SqlQueryRequest` | `SqlQueryResult` |
| **Redis** | `RedisTransportClient` | `RedisCommand` | `RedisCommandResult` |
| **DNS** | `DnsTransportClient` | `DnsRequest` | `DnsResult` |

All transport clients implement the base interface:

```typescript
interface TransportClient<TCommand, TResult> {
  exec(command: TCommand): Promise<TResult>;
}
```

## Configuration Schema

Define connection parameters in the config schema. Use `configString` and `configNumber` from `@checkstack/backend-api` for special field types:

```typescript
import { z, configString, configNumber } from "@checkstack/backend-api";

export const sshConfigSchema = z.object({
  host: z.string().describe("SSH server hostname"),
  port: z.number().int().min(1).max(65535).default(22).describe("SSH port"),
  username: z.string().describe("SSH username"),
  password: configString({ "x-secret": true })
    .describe("Password for authentication")
    .optional(),
  privateKey: configString({ "x-secret": true })
    .describe("Private key for authentication")
    .optional(),
  timeout: configNumber({})
    .min(100)
    .default(10_000)
    .describe("Connection timeout in milliseconds"),
});
```

### Secret Fields

Fields marked with `"x-secret": true` are:
- Encrypted at rest in the database
- Masked in the UI
- Never logged

## Result Schemas with Chart Metadata

Use `healthResultNumber`, `healthResultString`, etc. from `@checkstack/healthcheck-common` to annotate fields for auto-chart generation. **Always use `healthResultSchema()` for result schemas** - this enforces the use of factory functions at compile-time:

```typescript
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
  healthResultSchema,
} from "@checkstack/healthcheck-common";

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
```

### Chart Types

| Type | Use Case | Best For |
|------|----------|----------|
| `line` | Time series data | Latencies, response times |
| `bar` | Distributions | Status code counts |
| `counter` | Single numeric values | Counts, totals |
| `gauge` | Percentages (0-100) | Success rates |
| `boolean` | True/false indicators | Connected state |
| `text` | String display | Version info |
| `status` | Error/warning badges | Error messages |
| `pie` | Category distribution | Status code breakdown |

## Aggregated Result Schema

For bucket-level summaries during retention processing:

```typescript
const sshAggregatedSchema = healthResultSchema({
  avgConnectionTime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  successRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
});
```

## Complete Example

```typescript
import { Client } from "ssh2";
import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  configString,
  configNumber,
  mergeAverage,
  mergeRate,
  mergeCounter,
  averageStateSchema,
  rateStateSchema,
  counterStateSchema,
  type AverageState,
  type RateState,
  type CounterState,
  type ConnectedClient,
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
  healthResultSchema,
} from "@checkstack/healthcheck-common";

// Configuration schema
export const sshConfigSchema = z.object({
  host: z.string().describe("SSH server hostname"),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().describe("SSH username"),
  password: configString({ "x-secret": true }).optional(),
  privateKey: configString({ "x-secret": true }).optional(),
  timeout: configNumber({}).min(100).default(10_000),
});

type SshConfig = z.infer<typeof sshConfigSchema>;

// Transport client interface
interface SshTransportClient {
  exec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

// Per-run result
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

// Aggregated display schema (what's shown in charts)
const sshAggregatedDisplaySchema = healthResultSchema({
  avgConnectionTime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  successRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
});

// Aggregated internal schema (state for incremental aggregation)
const sshAggregatedInternalSchema = z.object({
  _connectionTime: averageStateSchema,
  _successRate: rateStateSchema,
  _errorCount: counterStateSchema,
});

const sshAggregatedSchema = sshAggregatedDisplaySchema.merge(sshAggregatedInternalSchema);
type SshAggregatedResult = z.infer<typeof sshAggregatedSchema>;

// Strategy implementation
export class SshHealthCheckStrategy
  implements HealthCheckStrategy<SshConfig, SshTransportClient, SshResult, SshAggregatedResult>
{
  id = "ssh";
  displayName = "SSH Health Check";
  description = "SSH server connectivity";

  config = new Versioned({ version: 1, schema: sshConfigSchema });
  result = new Versioned({ version: 1, schema: sshResultSchema });
  aggregatedResult = new Versioned({ version: 1, schema: sshAggregatedSchema });

  /**
   * Create a connected SSH transport client.
   */
  async createClient(config: SshConfig): Promise<ConnectedClient<SshTransportClient>> {
    const validatedConfig = this.config.validate(config);

    // Connect to SSH server
    const connection = await this.connect(validatedConfig);

    return {
      client: {
        exec: (command: string) => connection.exec(command),
      },
      close: () => connection.end(),
    };
  }

  mergeResult(
    existing: SshAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<SshResult>,
  ): SshAggregatedResult {
    const metadata = run.metadata;

    // Merge functions accept input without _type and return output with _type
    const connectionTime = mergeAverage(existing?._connectionTime, metadata?.connectionTimeMs);
    const successRate = mergeRate(existing?._successRate, metadata?.connected);
    const errorCount = mergeCounter(existing?._errorCount, !!metadata?.error);

    // State objects now include _type discriminator for reliable type detection
    // e.g., connectionTime = { _type: "average", _sum: 100, _count: 2, avg: 50 }
    return {
      _connectionTime: connectionTime,
      _successRate: successRate,
      _errorCount: errorCount,
      avgConnectionTime: connectionTime.avg,
      successRate: successRate.rate,
      errorCount: errorCount.count,
    };
  }

  private connect(config: SshConfig): Promise<SshConnection> {
    return new Promise((resolve, reject) => {
      const client = new Client();

      client.on("ready", () => {
        resolve({
          exec(command: string) {
            return new Promise((execResolve, execReject) => {
              client.exec(command, (err, stream) => {
                if (err) return execReject(err);

                let stdout = "";
                let stderr = "";

                stream.on("data", (data: Buffer) => (stdout += data.toString()));
                stream.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
                stream.on("close", (code: number | null) => {
                  execResolve({ exitCode: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() });
                });
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
        readyTimeout: config.timeout,
      });
    });
  }
}

interface SshConnection {
  exec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  end(): void;
}
```

## Plugin Registration

Register strategies in your plugin's `init` phase:

```typescript
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { SshHealthCheckStrategy } from "./strategy";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerInit({
      deps: {
        healthCheckRegistry: coreServices.healthCheckRegistry,
        logger: coreServices.logger,
      },
      init: async ({ healthCheckRegistry, logger }) => {
        healthCheckRegistry.register(new SshHealthCheckStrategy());
        logger.info("✅ SSH health check strategy registered");
      },
    });
  },
});
```

> [!IMPORTANT]
> Strategy IDs are automatically qualified with the owning plugin ID.
> A strategy with `id = "ssh"` registered by `healthcheck-ssh-backend` becomes `healthcheck-ssh-backend.ssh`.

## Extending with Collectors

Strategies provide the transport layer. To add domain-specific metrics collection, create **collectors** that receive the connected transport client.

For example, the SSH strategy provides an `SshTransportClient`. Collectors like CPU, Memory, and Disk use this client to run shell commands and parse results.

See [Collector Plugin Development](./collectors.md) for details on creating collectors.

## Testing

Use dependency injection to mock the underlying client library:

```typescript
import { describe, it, expect, mock } from "bun:test";
import { SshHealthCheckStrategy, type SshClient } from "./strategy";

describe("SshHealthCheckStrategy", () => {
  it("should create client and allow command execution", async () => {
    // Mock SSH client
    const mockSshClient: SshClient = {
      connect: mock().mockResolvedValue({
        exec: mock().mockResolvedValue({
          exitCode: 0,
          stdout: "hello",
          stderr: "",
        }),
        end: mock(),
      }),
    };

    const strategy = new SshHealthCheckStrategy(mockSshClient);
    const { client, close } = await strategy.createClient({
      host: "test.example.com",
      port: 22,
      username: "testuser",
      password: "testpass",
      timeout: 10000,
    });

    const result = await client.exec("echo hello");
    expect(result.stdout).toBe("hello");

    close();
    expect(mockSshClient.connect).toHaveBeenCalled();
  });
});
```

## Next Steps

- [Collector Plugin Development](./collectors.md) - Extend strategies with collectors
- [Versioned Configurations](./versioned-configs.md) - Schema versioning and migrations
- [Plugin Development Guide](./plugins.md) - General plugin patterns
