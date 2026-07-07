import type {
  StateThresholds,
  HealthCheckStatus,
} from "@checkstack/healthcheck-common";
import type { HealthCheckOverviewItem } from "./HealthCheckOverviewRow";

/**
 * Minimal structural shapes of the `getSystemHealthOverview` response consumed
 * by the row builder. Declared locally (rather than importing the full RPC
 * output type) so the pure logic is trivially unit-testable — the real client
 * data is structurally assignable to these.
 */
export interface OverviewRunLike {
  status: HealthCheckStatus;
  timestamp: Date | string;
}

export interface OverviewPerEnvLike {
  environmentId: string | null;
  status: HealthCheckStatus;
  lastSuccessfulRunAt?: Date | string;
  recentRuns: OverviewRunLike[];
}

export interface OverviewCheckLike {
  configurationId: string;
  strategyId: string;
  configurationName: string;
  status: HealthCheckStatus;
  paused: boolean;
  intervalSeconds: number;
  stateThresholds?: StateThresholds;
  lastSuccessfulRunAt?: Date | string;
  recentRuns: OverviewRunLike[];
  perEnvironment?: OverviewPerEnvLike[];
}

function lastRunAt(runs: OverviewRunLike[]): Date | undefined {
  const last = runs.at(-1)?.timestamp;
  return last ? new Date(last) : undefined;
}

function toDate(value: Date | string | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}

/**
 * A slice is orphaned (old) when it no longer receives runs: a concrete
 * environment that is no longer part of the system, or the env-less (`null`)
 * slice of a check that currently fans out to a live environment.
 */
function isSliceOrphaned({
  environmentId,
  currentEnvIds,
  hasLiveEnvSlice,
}: {
  environmentId: string | null;
  currentEnvIds: Set<string>;
  hasLiveEnvSlice: boolean;
}): boolean {
  return environmentId === null
    ? hasLiveEnvSlice
    : !currentEnvIds.has(environmentId);
}

/**
 * Flattens the system-health overview into one row per (check, environment),
 * tagging each row's `isOrphaned` state.
 *
 * A slice is "orphaned" (old) when it no longer receives runs:
 * - a concrete environment that is no longer part of the system (removed, or
 *   all environments removed), or
 * - the env-less (`null`) slice of a check that currently fans out to real
 *   environments (was env-less before environments were added).
 *
 * The env-less slice is the ambiguous one: it is live when the check does NOT
 * currently fan out (opt-out, or the system has no environments so runs are
 * env-less again), and stale only when the check DOES fan out to an environment
 * the system still has. `hasLiveEnvSlice` is exactly that disambiguator.
 */
export function buildOverviewRows({
  checks,
  environmentIds,
  envNameById,
}: {
  checks: OverviewCheckLike[];
  environmentIds: string[];
  envNameById: Map<string, string>;
}): HealthCheckOverviewItem[] {
  const currentEnvIds = new Set(environmentIds);
  const rows: HealthCheckOverviewItem[] = [];

  for (const check of checks) {
    const stateThresholds = check.stateThresholds;
    const perEnv = check.perEnvironment;

    const hasLiveEnvSlice = (perEnv ?? []).some(
      (pe) => pe.environmentId !== null && currentEnvIds.has(pe.environmentId),
    );

    if (!perEnv || perEnv.length <= 1) {
      // Single-env / env-less: keep the historical single-row shape (the
      // check-level rollup). Surface the env pill only when this lone slice
      // is an orphaned, now-removed environment so the operator sees which
      // env it was.
      const only = perEnv?.[0];
      const environmentId = only ? only.environmentId : undefined;
      const orphaned =
        environmentId !== undefined &&
        isSliceOrphaned({ environmentId, currentEnvIds, hasLiveEnvSlice });
      rows.push({
        rowKey: check.configurationId,
        configurationId: check.configurationId,
        strategyId: check.strategyId,
        name: check.configurationName,
        state: check.status,
        paused: check.paused,
        intervalSeconds: check.intervalSeconds,
        lastRunAt: lastRunAt(check.recentRuns),
        lastSuccessfulRunAt: toDate(check.lastSuccessfulRunAt),
        stateThresholds,
        recentStatusHistory: check.recentRuns.map((r) => r.status),
        environmentId: orphaned ? environmentId : undefined,
        // Left undefined when the env can't be resolved (deleted) so the row
        // renders a "Removed environment" label rather than a raw id.
        environmentName:
          orphaned && environmentId
            ? envNameById.get(environmentId)
            : undefined,
        isOrphaned: orphaned,
      });
      continue;
    }

    // Multi-env: one row per environment. `state` is the per-env rollup, so
    // the failing/healthy filter applies per env. Clicking any row opens the
    // drawer for the whole check.
    for (const pe of perEnv) {
      const environmentId = pe.environmentId;
      // Undefined for the env-less slice or an unresolvable (deleted) env; the
      // row turns the latter into a "Removed environment" label.
      const envName =
        environmentId === null ? undefined : envNameById.get(environmentId);
      rows.push({
        rowKey: `${check.configurationId}::${environmentId ?? "<none>"}`,
        configurationId: check.configurationId,
        strategyId: check.strategyId,
        name: check.configurationName,
        state: pe.status,
        paused: check.paused,
        intervalSeconds: check.intervalSeconds,
        lastRunAt: lastRunAt(pe.recentRuns),
        lastSuccessfulRunAt: toDate(pe.lastSuccessfulRunAt),
        stateThresholds,
        recentStatusHistory: pe.recentRuns.map((r) => r.status),
        environmentId,
        environmentName: envName,
        isOrphaned: isSliceOrphaned({
          environmentId,
          currentEnvIds,
          hasLiveEnvSlice,
        }),
      });
    }
  }

  return rows;
}
