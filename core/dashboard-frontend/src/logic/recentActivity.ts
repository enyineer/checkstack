/** A health-check run status as broadcast on `HEALTH_CHECK_RUN_COMPLETED`. */
export type RunActivityStatus = "healthy" | "degraded" | "unhealthy";

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
 * label shown by the Health Checks runs table. Env-less runs render exactly as
 * before so non-environment-scoped runs stay unchanged.
 */
export function buildRunActivityContent({
  systemName,
  configurationName,
  status,
  environmentName,
}: BuildRunActivityContentArgs): string {
  const base = `${systemName} (${configurationName})`;
  const scope = environmentName ? `${base} @ ${environmentName}` : base;
  return `${scope} → ${status}`;
}
