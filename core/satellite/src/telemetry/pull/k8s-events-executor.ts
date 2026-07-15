import { createGuardedFetch, type GuardedLookupFn } from "@checkstack/backend-api";
import type { Logger } from "@checkstack/common";
import {
  normalizedLogRecordToWire,
  type SatellitePullExecutor,
  type WirePullRecords,
} from "@checkstack/telemetry-common";
import {
  K8S_EVENTS_SOURCE_TYPE_ID,
  k8sEventsPublicConfigSchema,
  runK8sEventsPull,
} from "@checkstack/k8s-events-common";

/**
 * Agent-side pull executor for the Kubernetes-events source type.
 *
 * Lives HERE (the satellite package, next to the Prometheus executor) rather
 * than in `k8s-events-common`, because it needs the SSRF egress guard from
 * `@checkstack/backend-api` and a `*-common` leaf must not import backend
 * packages (enforce-architecture-deps). The PURE driver
 * (`runK8sEventsPull`) stays in the common leaf and is shared with the core
 * backend `execute`, so an instance pulled by a satellite is shaped
 * identically to one pulled by core. The guard allows private ranges but
 * denies cloud-metadata/link-local, so a satellite in a customer network
 * cannot be turned into an SSRF pivot.
 *
 * Secrets never ride the config: the bearer token is fetched just-in-time via
 * `ctx.fetchSecret("bearerToken")`.
 */

/** Silent logger for the guarded fetch (the satellite ctx supplies none). */
const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

/**
 * Build the executor. `fetchImpl` / `lookupFn` are injectable ONLY for tests;
 * production passes neither, so the real global fetch and DNS resolver are used
 * behind the SSRF guard.
 */
export function createK8sEventsPullExecutor(
  opts: {
    fetchImpl?: typeof fetch;
    lookupFn?: GuardedLookupFn;
    now?: () => Date;
  } = {},
): SatellitePullExecutor {
  return {
    sourceTypeId: K8S_EVENTS_SOURCE_TYPE_ID,
    async execute({
      config,
      fetchSecret,
      abortSignal,
      logger,
    }): Promise<WirePullRecords> {
      const publicConfig = k8sEventsPublicConfigSchema.parse(config);
      const bearerToken = await fetchSecret("bearerToken");
      if (!bearerToken) {
        throw new Error("k8s-events: missing bearerToken secret");
      }

      const guardedFetch = createGuardedFetch({
        logger: silentLogger,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        ...(opts.lookupFn ? { lookupFn: opts.lookupFn } : {}),
      });

      const { records, truncated } = await runK8sEventsPull({
        config: { ...publicConfig, bearerToken },
        fetchImpl: guardedFetch,
        ...(opts.now ? { now: opts.now } : {}),
        ...(abortSignal ? { abortSignal } : {}),
      });
      if (truncated) {
        // Same operator guidance as the core-side execute in
        // plugins/k8s-events-backend: a partial window needs a narrower list.
        logger?.warn(
          "kubernetes events pull hit the page-scan budget before reaching the end of the cluster's event backlog; emitted records are a partial view of the window. Narrow the stream with a namespace or fieldSelector to keep every recent event in budget.",
        );
      }

      return { logs: records.map((record) => normalizedLogRecordToWire(record)) };
    },
  };
}

/** The registerable executor instance (the satellite build wires this). */
export const k8sEventsPullExecutor = createK8sEventsPullExecutor();
