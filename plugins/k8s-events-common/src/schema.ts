import { z } from "zod";

/**
 * Config schema for a Kubernetes-events telemetry source instance.
 *
 * VERIFIED against the official Kubernetes API reference (events.k8s.io/v1) and
 * the authentication reference:
 * - List endpoints: `GET /apis/events.k8s.io/v1/events` (all namespaces) and
 *   `GET /apis/events.k8s.io/v1/namespaces/{namespace}/events` (single ns).
 * - Auth: `Authorization: Bearer <token>` (RFC 6750 service-account token).
 * - Query params: `limit`, `continue`, `fieldSelector`, `labelSelector`.
 * See `pull.ts` / `k8s-event.ts` for where each is used.
 *
 * `bearerToken` MUST stay a plain string (no refinement) so the platform's
 * internal-secret marker round-trips through it (see the telemetry secret-field
 * validator, which probes every `x-secret` field with a marker string).
 */

/** Bounds for `maxEventsPerPull`. */
export const K8S_EVENTS_MAX_PER_PULL_MIN = 1;
export const K8S_EVENTS_MAX_PER_PULL_MAX = 5000;
export const K8S_EVENTS_MAX_PER_PULL_DEFAULT = 500;

/**
 * Bounds for `lookbackSeconds` - the client-side time window applied to each
 * pull (see `window.ts`). The platform gives a pull executor NO persistent
 * cursor, so "new events since the last pull" is approximated by a time window.
 * Set this slightly ABOVE the instance's pull interval: the overlap
 * (lookback - interval) is the window in which an event may be emitted twice; a
 * value BELOW the interval drops events. Each record carries a stable identity
 * (`k8s.event.uid` + `k8s.event.series_count`) so duplicates can be deduped
 * downstream in a future revision.
 */
export const K8S_EVENTS_LOOKBACK_MIN = 15;
export const K8S_EVENTS_LOOKBACK_MAX = 3600;
export const K8S_EVENTS_LOOKBACK_DEFAULT = 90;

export const k8sEventsConfigSchema = z.object({
  apiServerUrl: z
    .string()
    .url()
    .refine(
      (value) => {
        try {
          return new URL(value).protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "apiServerUrl must be an https URL" },
    )
    .describe("Kubernetes API server base URL (e.g. https://k8s.example:6443)"),
  // Plain string here (this is the PURE schema the browser-safe driver and
  // agent parse). The x-secret ANNOTATION lives on the backend package's
  // registered schema (see k8s-events-backend source-type.ts) - a *-common
  // must not import backend-api (enforce-architecture-deps).
  bearerToken: z
    .string()
    .describe(
      "Service-account bearer token (sent as Authorization: Bearer <token>)",
    ),
  namespace: z
    .string()
    .optional()
    .describe("Namespace to list events from. Empty = all namespaces."),
  fieldSelector: z
    .string()
    .optional()
    .describe("Optional Kubernetes fieldSelector query filter."),
  labelSelector: z
    .string()
    .optional()
    .describe("Optional Kubernetes labelSelector query filter."),
  maxEventsPerPull: z
    .number()
    .int()
    .min(K8S_EVENTS_MAX_PER_PULL_MIN)
    .max(K8S_EVENTS_MAX_PER_PULL_MAX)
    .default(K8S_EVENTS_MAX_PER_PULL_DEFAULT)
    .describe("Maximum events fetched (across pages) in one pull."),
  lookbackSeconds: z
    .number()
    .int()
    .min(K8S_EVENTS_LOOKBACK_MIN)
    .max(K8S_EVENTS_LOOKBACK_MAX)
    .default(K8S_EVENTS_LOOKBACK_DEFAULT)
    .describe(
      "Client-side time window (seconds) of events to emit each pull. Set slightly above the pull interval.",
    ),
});

/** Resolved config as handed to the pull driver (secrets already resolved). */
export type K8sEventsConfig = z.infer<typeof k8sEventsConfigSchema>;

/**
 * The NON-SECRET config the satellite receives (secret fields are omitted from
 * the pushed config; the agent fetches them just-in-time). The executor parses
 * `ctx.config` with this, then assembles the full resolved config with the
 * bearer token fetched via `ctx.fetchSecret`.
 */
export const k8sEventsPublicConfigSchema = k8sEventsConfigSchema.omit({
  bearerToken: true,
});
export type K8sEventsPublicConfig = z.infer<typeof k8sEventsPublicConfigSchema>;
