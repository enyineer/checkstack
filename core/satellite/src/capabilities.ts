/**
 * Compute the capability list a satellite advertises, from env flags. The list
 * is sent in `authenticate` / `heartbeat` so the core can gate features (a
 * scrape target only binds to a satellite advertising "scrape") and surface
 * them in the UI.
 *
 * A2 owns the advertisement + the generic telemetry client; the concrete
 * receivers/scrapers behind "scrape" / "log-receivers" / "syslog" are wired by
 * SAT-B behind these SAME flags, so advertising and serving stay in lock-step.
 */
export const SATELLITE_CAPABILITY_FLAGS = {
  /** Enables the generic telemetry client (log/metric forwarding). */
  telemetry: "CHECKSTACK_SATELLITE_TELEMETRY",
  /** Satellite-side metric scraping of bound targets. */
  scrape: "CHECKSTACK_SATELLITE_SCRAPE",
  /** Satellite-side telemetry PULL execution of bound source instances. */
  "telemetry-pull": "CHECKSTACK_SATELLITE_TELEMETRY_PULL",
  /** Local HTTP OTLP/native log + metric receivers. */
  "log-receivers": "CHECKSTACK_SATELLITE_LOG_RECEIVERS",
  /** Local HTTP OTLP/native trace receivers. */
  "trace-receivers": "CHECKSTACK_SATELLITE_TRACE_RECEIVERS",
  /** Local syslog listener. */
  syslog: "CHECKSTACK_SATELLITE_SYSLOG",
} as const;

function isEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function computeCapabilities(
  env: Record<string, string | undefined>,
): string[] {
  const caps: string[] = [];
  for (const [capability, envVar] of Object.entries(
    SATELLITE_CAPABILITY_FLAGS,
  )) {
    if (isEnabled(env[envVar])) caps.push(capability);
  }
  return caps;
}

/**
 * Whether the telemetry client should run. Any forwarding capability
 * (telemetry / scrape / receivers / syslog) needs it, so it is active whenever
 * at least one capability is advertised.
 */
export function isTelemetryEnabled(capabilities: string[]): boolean {
  return capabilities.length > 0;
}
