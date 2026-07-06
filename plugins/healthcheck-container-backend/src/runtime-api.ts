import { z } from "@checkstack/backend-api";
import type {
  ContainerInspectData,
  ContainerStatsData,
} from "@checkstack/healthcheck-container-common";

// ============================================================================
// CONTAINER RUNTIME REST API CLIENT
// ============================================================================
//
// Speaks the Docker Engine / Podman libpod REST API over EITHER a unix socket
// path OR an http(s) endpoint, so the operator can point it at a read-only
// socket-proxy (`http://socket-proxy:2375`) or a rootless Podman socket
// (`/run/user/1000/podman/podman.sock`) - the raw runtime socket is never
// surfaced to Checkstack. Only GET endpoints are used, so a `POST=0` proxy is
// sufficient.
//
// Transport-failure boundary (see .claude/rules/healthcheck-collectors.md):
// a network error, timeout, or a non-404 error status THROWS (the probe could
// not complete). A 404 for a missing container is a COMPLETED call and returns
// a normal result (`exists: false` / empty stats) - existence is an assertable
// metric, not a transport failure.

/**
 * A `fetch`-shaped call that also accepts Bun's `unix` socket option. Injected
 * so the client is testable without a real runtime socket.
 */
export interface ContainerFetchInit {
  signal?: AbortSignal;
  unix?: string;
}

export type ContainerFetch = (
  url: string,
  init: ContainerFetchInit,
) => Promise<Response>;

const defaultFetch: ContainerFetch = (url, init) => fetch(url, init);

/**
 * Resolve an operator-supplied endpoint into a base URL + optional unix socket
 * path. Accepts:
 * - `http(s)://host:port` -> talked to directly (a socket-proxy over TCP).
 * - `unix:///path/to.sock` or a bare filesystem path -> a unix socket; the
 *   HTTP host is a placeholder Bun ignores when `unix` is set.
 */
export function resolveEndpoint(endpoint: string): {
  baseUrl: string;
  unixSocketPath?: string;
} {
  const trimmed = endpoint.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return { baseUrl: trimmed.replace(/\/+$/, "") };
  }
  const socketPath = trimmed.startsWith("unix://")
    ? trimmed.slice("unix://".length)
    : trimmed;
  return { baseUrl: "http://localhost", unixSocketPath: socketPath };
}

// --- Response parsing schemas (subset of the Engine API we read) ---

const inspectResponseSchema = z.object({
  State: z
    .object({
      Status: z.string().optional(),
      Running: z.boolean().optional(),
      ExitCode: z.number().optional(),
      OOMKilled: z.boolean().optional(),
      Health: z.object({ Status: z.string().optional() }).optional(),
    })
    .optional(),
  RestartCount: z.number().optional(),
});

const statsResponseSchema = z.object({
  cpu_stats: z
    .object({
      cpu_usage: z
        .object({
          total_usage: z.number().optional(),
          percpu_usage: z.array(z.number()).optional(),
        })
        .optional(),
      system_cpu_usage: z.number().optional(),
      online_cpus: z.number().optional(),
    })
    .optional(),
  precpu_stats: z
    .object({
      cpu_usage: z.object({ total_usage: z.number().optional() }).optional(),
      system_cpu_usage: z.number().optional(),
    })
    .optional(),
  memory_stats: z
    .object({
      usage: z.number().optional(),
      limit: z.number().optional(),
      stats: z.object({ cache: z.number().optional() }).optional(),
    })
    .optional(),
});

type StatsResponse = z.infer<typeof statsResponseSchema>;

/**
 * Docker's documented CPU-percent formula. Returns undefined when the deltas
 * are not measurable (e.g. a stopped container, or a single-read snapshot).
 */
export function computeCpuPercent(stats: StatsResponse): number | undefined {
  const cpu = stats.cpu_stats;
  const precpu = stats.precpu_stats;
  const cpuTotal = cpu?.cpu_usage?.total_usage;
  const preTotal = precpu?.cpu_usage?.total_usage;
  const system = cpu?.system_cpu_usage;
  const preSystem = precpu?.system_cpu_usage;
  if (
    cpuTotal === undefined ||
    preTotal === undefined ||
    system === undefined ||
    preSystem === undefined
  ) {
    return undefined;
  }
  const cpuDelta = cpuTotal - preTotal;
  const systemDelta = system - preSystem;
  if (systemDelta <= 0 || cpuDelta < 0) {
    return undefined;
  }
  const onlineCpus =
    cpu?.online_cpus ?? cpu?.cpu_usage?.percpu_usage?.length ?? 1;
  return (cpuDelta / systemDelta) * onlineCpus * 100;
}

/**
 * Distil a stats response into the assertable memory/cpu metrics. Cache is
 * subtracted from usage where the runtime reports it (matching `docker stats`).
 */
export function distillStats(stats: StatsResponse): ContainerStatsData {
  const cpuPercent = computeCpuPercent(stats);
  const rawUsage = stats.memory_stats?.usage;
  const cache = stats.memory_stats?.stats?.cache ?? 0;
  const memoryUsageBytes =
    rawUsage === undefined ? undefined : Math.max(0, rawUsage - cache);
  const memoryLimitBytes = stats.memory_stats?.limit;
  const memoryPercent =
    memoryUsageBytes !== undefined &&
    memoryLimitBytes !== undefined &&
    memoryLimitBytes > 0
      ? (memoryUsageBytes / memoryLimitBytes) * 100
      : undefined;
  return {
    cpuPercent,
    memoryUsageBytes,
    memoryLimitBytes,
    memoryPercent,
  };
}

export interface RuntimeApi {
  /** Verify the runtime endpoint is reachable. Throws on transport failure. */
  ping(): Promise<void>;
  /** Inspect the bound container. A 404 returns `{ exists: false }`. */
  inspect(): Promise<ContainerInspectData>;
  /** Snapshot stats for the bound container. A 404 returns empty stats. */
  stats(): Promise<ContainerStatsData>;
}

/**
 * Build a {@link RuntimeApi} bound to one container against one endpoint.
 */
export function createRuntimeApi({
  endpoint,
  container,
  timeoutMs,
  fetchImpl = defaultFetch,
}: {
  endpoint: string;
  container: string;
  timeoutMs: number;
  fetchImpl?: ContainerFetch;
}): RuntimeApi {
  const { baseUrl, unixSocketPath } = resolveEndpoint(endpoint);
  const encoded = encodeURIComponent(container);

  const request = async (pathAndQuery: string): Promise<Response> => {
    const init: ContainerFetchInit = {
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (unixSocketPath !== undefined) {
      init.unix = unixSocketPath;
    }
    return fetchImpl(`${baseUrl}${pathAndQuery}`, init);
  };

  return {
    async ping(): Promise<void> {
      const response = await request("/_ping");
      if (!response.ok) {
        throw new Error(
          `Container runtime endpoint returned ${response.status} for /_ping (is the socket-proxy running and reachable?)`,
        );
      }
    },

    async inspect(): Promise<ContainerInspectData> {
      const response = await request(`/containers/${encoded}/json`);
      if (response.status === 404) {
        return { exists: false };
      }
      if (!response.ok) {
        throw new Error(
          `Container inspect failed with status ${response.status}`,
        );
      }
      const parsed = inspectResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error("Unexpected container inspect response shape");
      }
      const state = parsed.data.State;
      return {
        exists: true,
        state: state?.Status,
        running: state?.Running,
        health: state?.Health?.Status,
        exitCode: state?.ExitCode,
        restartCount: parsed.data.RestartCount,
        oomKilled: state?.OOMKilled,
      };
    },

    async stats(): Promise<ContainerStatsData> {
      const response = await request(`/containers/${encoded}/stats?stream=false`);
      if (response.status === 404) {
        return {};
      }
      if (!response.ok) {
        throw new Error(
          `Container stats failed with status ${response.status}`,
        );
      }
      const parsed = statsResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        return {};
      }
      return distillStats(parsed.data);
    },
  };
}
