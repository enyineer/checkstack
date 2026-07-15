/**
 * Compute the capability list a satellite advertises, from env flags. The list
 * is sent in `authenticate` / `heartbeat` so the core can gate features (a
 * telemetry-pull source only binds to a satellite advertising "telemetry-pull")
 * and surface them in the UI.
 *
 * A2 owns the advertisement + the generic telemetry client; the concrete
 * receivers/schedulers behind "telemetry-pull" / "log-receivers" / "syslog" are
 * wired by SAT-B behind these SAME flags, so advertising and serving stay in
 * lock-step.
 */
export const SATELLITE_CAPABILITY_FLAGS = {
  /** Enables the generic telemetry client (log/metric forwarding). */
  telemetry: "CHECKSTACK_SATELLITE_TELEMETRY",
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
 * (telemetry / telemetry-pull / receivers / syslog) needs it, so it is active
 * whenever at least one capability is advertised.
 */
export function isTelemetryEnabled(capabilities: string[]): boolean {
  return capabilities.length > 0;
}

/**
 * Env var removed this phase: the bespoke metric-scrape capability was replaced
 * by the generic telemetry-pull capability, so this flag no longer does
 * anything.
 */
export const REMOVED_SCRAPE_ENV_VAR = "CHECKSTACK_SATELLITE_SCRAPE";

/**
 * Decide whether to warn about the removed {@link REMOVED_SCRAPE_ENV_VAR}. It no
 * longer has any effect - a satellite now advertises the generic telemetry-pull
 * capability (via {@link SATELLITE_CAPABILITY_FLAGS}'s
 * `CHECKSTACK_SATELLITE_TELEMETRY_PULL`) and runs bound Prometheus scrape sources
 * through it. Returns the warning message when the var is set to a non-empty
 * value, else null. Pure + testable.
 */
export function removedScrapeEnvWarning(
  env: Record<string, string | undefined>,
): string | null {
  const value = env[REMOVED_SCRAPE_ENV_VAR];
  if (value === undefined || value.trim() === "") return null;
  return (
    `${REMOVED_SCRAPE_ENV_VAR} is set but no longer has any effect: scraping moved ` +
    `to the generic telemetry-pull capability. Enable it with ` +
    `${SATELLITE_CAPABILITY_FLAGS["telemetry-pull"]} instead.`
  );
}
