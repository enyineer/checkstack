import { defineTelemetrySourceType } from "@checkstack/telemetry-backend";
import { configString } from "@checkstack/backend-api";
import {
  K8S_EVENTS_TYPE_ID,
  k8sEventsConfigSchema,
  runK8sEventsPull,
  type K8sEventsConfig,
} from "@checkstack/k8s-events-common";

/** Default and minimum pull cadence for a Kubernetes-events instance. */
export const K8S_EVENTS_DEFAULT_INTERVAL_SECONDS = 60;
export const K8S_EVENTS_MIN_INTERVAL_SECONDS = 15;

/**
 * The Kubernetes-events source type: interval-LIST the cluster's
 * `events.k8s.io/v1` events and emit new ones as normalized log records.
 *
 * The pull is CURSORLESS (the platform hands the executor no persistent state),
 * so "new since last pull" is a client-side time window (`lookbackSeconds`);
 * see `@checkstack/k8s-events-common`'s `window.ts` for the tradeoff. Satellite
 * execution is supported via the satellite-side executor
 * (`core/satellite/src/telemetry/pull/k8s-events-executor.ts` - it wraps the
 * backend-api SSRF guard, which this package's *-common leaf must not
 * import); both paths run the same `runK8sEventsPull` driver.
 */
export const k8sEventsSourceType = defineTelemetrySourceType<K8sEventsConfig>({
  id: K8S_EVENTS_TYPE_ID,
  displayName: "Kubernetes events",
  description:
    "Poll a Kubernetes cluster's events.k8s.io/v1 events and stream them as logs.",
  icon: "Boxes",
  signals: ["logs"],
  // The REGISTERED schema re-annotates the pure common schema's secret field
  // with x-secret metadata (encrypt at rest, mask on read, JIT on satellites).
  // Runtime validation is identical to the pure schema the pull driver uses.
  configSchema: k8sEventsConfigSchema.extend({
    bearerToken: configString({ "x-secret": true }).describe(
      "Service-account bearer token (sent as Authorization: Bearer <token>)",
    ),
  }),
  supportsSatellite: true,
  pull: {
    defaultIntervalSeconds: K8S_EVENTS_DEFAULT_INTERVAL_SECONDS,
    minIntervalSeconds: K8S_EVENTS_MIN_INTERVAL_SECONDS,
    async execute({ config, sink, fetch, logger, abortSignal }) {
      const { records, truncated } = await runK8sEventsPull({
        config,
        fetchImpl: fetch,
        abortSignal,
      });
      if (truncated) {
        logger.warn(
          "kubernetes events pull hit the page-scan budget before reaching the end of the cluster's event backlog; emitted records are a partial view of the window. Narrow the stream with a namespace or fieldSelector to keep every recent event in budget.",
        );
      }
      if (records.length > 0) {
        await sink.emit("logs", records);
      }
    },
  },
});
