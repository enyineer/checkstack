import { z } from "zod";

/**
 * The telemetry signals the platform routes. A SOURCE (a pluggable way
 * telemetry enters the platform - a poller, a webhook, a listener) declares
 * which signals it can emit; a SINK (contributed by the plugin that owns a
 * signal's streams - logstream, metricstream, tracestream) accepts normalized
 * records for exactly one signal.
 *
 * The trio is deliberately closed for now: adding a signal kind means adding a
 * normalized record schema (see `./records`) and a sink, which is a platform
 * change, not a plugin contribution. The registry APIs are keyed on this enum
 * so a future fourth signal (profiles, RUM sessions, ...) is an addition, not
 * a redesign.
 */
export const TELEMETRY_SIGNALS = ["logs", "metrics", "traces"] as const;

export const TelemetrySignalSchema = z.enum(TELEMETRY_SIGNALS);
export type TelemetrySignal = z.infer<typeof TelemetrySignalSchema>;
