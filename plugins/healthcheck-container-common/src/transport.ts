import type { TransportClient } from "@checkstack/common";

// ============================================================================
// CONTAINER TRANSPORT TYPES
// ============================================================================
//
// The container transport speaks the Docker Engine / Podman libpod REST API
// over a connection that is bound to a SINGLE container in `createClient`
// (via the strategy's `container` config), so commands only name the read they
// want. Every command maps to a GET request, so the whole transport works
// against a READ-ONLY socket-proxy (`POST=0`) - the raw runtime socket is never
// surfaced to Checkstack.

/**
 * A read command against the bound container. Both map to GET requests
 * (`/containers/{id}/json`, `/containers/{id}/stats?stream=false`) so they are
 * safe against a read-only socket-proxy.
 */
export type ContainerCommand = { type: "inspect" } | { type: "stats" };

/**
 * Inspect data distilled from `GET /containers/{id}/json`. Every field is an
 * ASSERTABLE METRIC, never a reason to fail the collector: a stopped or missing
 * container is a completed API call, not a transport failure.
 */
export interface ContainerInspectData {
  /** Whether the container exists on the host (a 404 sets this false). */
  exists: boolean;
  /**
   * Raw runtime state string:
   * `created|running|paused|restarting|removing|exited|dead`.
   */
  state?: string;
  /** Whether the container's main process is currently running. */
  running?: boolean;
  /**
   * Docker/Podman health status when a HEALTHCHECK is defined:
   * `healthy|unhealthy|starting|none`. Absent when the image declares no
   * healthcheck.
   */
  health?: string;
  /** Exit code of the main process (meaningful once the container exited). */
  exitCode?: number;
  /** Number of times the runtime has restarted the container. */
  restartCount?: number;
  /** Whether the last run was killed by the OOM killer. */
  oomKilled?: boolean;
}

/**
 * Stats data distilled from `GET /containers/{id}/stats?stream=false`. Fields
 * are optional because a non-running container returns partial/empty stats -
 * that is a metric, not a failure.
 */
export interface ContainerStatsData {
  /** CPU utilisation percent across all online CPUs. */
  cpuPercent?: number;
  /** Resident memory usage in bytes (cache-excluded where the runtime reports it). */
  memoryUsageBytes?: number;
  /** Memory limit in bytes (the container's cgroup limit). */
  memoryLimitBytes?: number;
  /** Memory usage as a percent of the limit. */
  memoryPercent?: number;
}

/**
 * Discriminated result of a {@link ContainerCommand}. The `type` discriminant
 * matches the command so a collector can narrow the shape it asked for.
 */
export type ContainerCommandResult =
  | ({ type: "inspect" } & ContainerInspectData)
  | ({ type: "stats" } & ContainerStatsData);

/**
 * Transport client for the container runtime REST API, bound to one container.
 */
export type ContainerTransportClient = TransportClient<
  ContainerCommand,
  ContainerCommandResult
>;
