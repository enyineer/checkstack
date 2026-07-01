/** A health-check run status as broadcast on `HEALTH_CHECK_RUN_COMPLETED`. */
export type RunActivityStatus = "healthy" | "degraded" | "unhealthy";

/**
 * Max rendered length of an inline environment name. The terminal feed shows
 * one event per line, so an unbounded env name would wrap the line and push the
 * ` → status` off on its own. Names longer than this are clipped with an
 * ellipsis so every entry stays compact and readable.
 */
const MAX_ENVIRONMENT_NAME_LENGTH = 24;

const truncateEnvironmentName = (name: string): string =>
  name.length > MAX_ENVIRONMENT_NAME_LENGTH
    ? `${name.slice(0, MAX_ENVIRONMENT_NAME_LENGTH - 1).trimEnd()}…`
    : name;

export interface BuildRunActivityContentArgs {
  systemName: string;
  configurationName: string;
  status: RunActivityStatus;
  /**
   * The environment a run was fanned out to. Omitted (or empty) for env-less
   * runs, which keep the original `system (config) -> status` format.
   */
  environmentName?: string;
}

/**
 * Build the one-line terminal-feed content for a completed health-check run.
 *
 * When the run was fanned out to an environment, the environment name is
 * surfaced inline (`system (config) @ env -> status`), matching the environment
 * label shown by the Health Checks runs table. Long env names are clipped with
 * an ellipsis so the entry stays on one terminal line. Env-less runs render
 * exactly as before so non-environment-scoped runs stay unchanged.
 */
export function buildRunActivityContent({
  systemName,
  configurationName,
  status,
  environmentName,
}: BuildRunActivityContentArgs): string {
  const base = `${systemName} (${configurationName})`;
  const scope = environmentName
    ? `${base} @ ${truncateEnvironmentName(environmentName)}`
    : base;
  return `${scope} → ${status}`;
}
