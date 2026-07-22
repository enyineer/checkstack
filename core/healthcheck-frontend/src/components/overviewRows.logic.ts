import {
  type StateThresholds,
  type HealthCheckStatus,
  type EnvironmentSelector,
  selectorIncludesEnvironment,
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
  /**
   * The per-assignment environment selector (`null` = all, `[]` = opt-out, a
   * list = exactly those ids). Combined with system membership so a slice whose
   * env was DISABLED for this assignment - but is still part of the system - is
   * still detected as orphaned. Optional so older callers/tests stay valid
   * (absent = `null` = all current environments).
   */
  environmentIds?: EnvironmentSelector;
}

function lastRunAt(runs: OverviewRunLike[]): Date | undefined {
  const last = runs.at(-1)?.timestamp;
  return last ? new Date(last) : undefined;
}

function toDate(value: Date | string | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}

const overviewCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

/**
 * Deterministic, update-stable ordering for the overview rows.
 *
 * The backend `getSystemHealthOverview` returns checks in an unspecified order
 * (its association query has no `ORDER BY`), so the physical order can shift
 * between refetches as rows are updated - making the list "jump around" while
 * the user watches. We therefore impose a stable order here, keyed ONLY on
 * identity fields (check name, then the invariant configuration id as a
 * tiebreaker for same-named checks, then the environment: the env-less/rollup
 * slice first, then environments by name and id). Crucially it never sorts on
 * `state`/timestamps, so a row keeps its position when its health changes.
 * `Array.prototype.sort` is stable, so any residual ties keep insertion order.
 */
function compareOverviewRows(
  a: HealthCheckOverviewItem,
  b: HealthCheckOverviewItem,
): number {
  const byName = overviewCollator.compare(a.name, b.name);
  if (byName !== 0) return byName;
  if (a.configurationId !== b.configurationId) {
    return a.configurationId < b.configurationId ? -1 : 1;
  }
  const aEnvless = a.environmentId == null;
  const bEnvless = b.environmentId == null;
  if (aEnvless !== bEnvless) return aEnvless ? -1 : 1;
  if (aEnvless) return 0;
  const byEnvName = overviewCollator.compare(
    a.environmentName ?? "",
    b.environmentName ?? "",
  );
  if (byEnvName !== 0) return byEnvName;
  const aid = a.environmentId ?? "";
  const bid = b.environmentId ?? "";
  return aid < bid ? -1 : aid > bid ? 1 : 0;
}

/**
 * Whether a concrete environment currently RECEIVES runs for this assignment:
 * it must still be part of the system (`currentEnvIds`) AND still be selected by
 * the assignment's `environmentIds`. Disabling an env for the assignment fails
 * the second test even though the env is still in the system, so its slice is
 * correctly treated as orphaned.
 */
function isConcreteEnvLive({
  environmentId,
  currentEnvIds,
  environmentIds,
}: {
  environmentId: string;
  currentEnvIds: Set<string>;
  environmentIds: EnvironmentSelector;
}): boolean {
  return (
    currentEnvIds.has(environmentId) &&
    selectorIncludesEnvironment({ environmentIds, environmentId })
  );
}

/**
 * How many missed intervals before a slice is taken to have STOPPED receiving
 * runs. Generous on purpose: a probe that is merely slow, backed off, or
 * recovering from a blip must never be mistaken for a dead slice.
 */
const ORPHAN_MISSED_INTERVALS = 5;

/** Floor for fast checks, so a 10s probe needs a real outage, not 50 seconds. */
const ORPHAN_MIN_SILENCE_MS = 10 * 60 * 1000;

/**
 * Has this slice actually stopped receiving runs?
 *
 * A slice with NO runs at all is not stale - it is pending, and has simply
 * never been executed (a freshly-added environment). Only a slice that ran and
 * then went quiet for several intervals counts as stopped.
 */
function hasStoppedReceivingRuns({
  recentRuns,
  intervalSeconds,
  now,
}: {
  recentRuns: OverviewRunLike[];
  intervalSeconds: number;
  now: Date;
}): boolean {
  const last = lastRunAt(recentRuns);
  if (!last) return false;
  const silenceMs = Math.max(
    intervalSeconds * 1000 * ORPHAN_MISSED_INTERVALS,
    ORPHAN_MIN_SILENCE_MS,
  );
  return now.getTime() - last.getTime() > silenceMs;
}

/**
 * A slice is orphaned (old) when it no longer receives runs:
 *
 * - a CONCRETE environment that is no longer part of the system, or was
 *   disabled for this assignment. That is decided structurally because it is
 *   certain: such a slice can never be run again, so waiting for it to go quiet
 *   would only delay a label we already know is right.
 * - the ENV-LESS (`null`) slice of a check that fans out to a live environment
 *   AND has itself gone quiet.
 *
 * That second condition is the fix for a real bug. The env-less slice used to be
 * called orphaned on the structural test alone, reasoning that a check which
 * fans out per environment cannot still be writing env-less runs. Satellites
 * break that: they receive no environment information at all, so EVERY satellite
 * result is written env-less. A check assigned to both the local core and a
 * satellite therefore had its satellite slice - the freshest data on the page -
 * labelled "Old checks" the instant the satellite first reported.
 *
 * Requiring actual silence makes the rule mean what its name says, for
 * satellites and for any future env-less writer.
 */
function isSliceOrphaned({
  environmentId,
  currentEnvIds,
  environmentIds,
  hasLiveEnvSlice,
  recentRuns,
  intervalSeconds,
  now,
}: {
  environmentId: string | null;
  currentEnvIds: Set<string>;
  environmentIds: EnvironmentSelector;
  hasLiveEnvSlice: boolean;
  recentRuns: OverviewRunLike[];
  intervalSeconds: number;
  now: Date;
}): boolean {
  return environmentId === null
    ? hasLiveEnvSlice &&
        hasStoppedReceivingRuns({ recentRuns, intervalSeconds, now })
    : !isConcreteEnvLive({ environmentId, currentEnvIds, environmentIds });
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
 * env-less again), OR when something is still writing env-less runs for it -
 * which is exactly what every satellite does, since satellites are handed no
 * environment information. It is stale only when the check fans out to a live
 * environment AND the slice has itself gone quiet.
 */
export function buildOverviewRows({
  checks,
  environmentIds,
  envNameById,
  now = new Date(),
}: {
  checks: OverviewCheckLike[];
  environmentIds: string[];
  envNameById: Map<string, string>;
  /** Injectable so the "has it gone quiet" test is deterministic. */
  now?: Date;
}): HealthCheckOverviewItem[] {
  const currentEnvIds = new Set(environmentIds);
  const rows: HealthCheckOverviewItem[] = [];

  for (const check of checks) {
    const stateThresholds = check.stateThresholds;
    const perEnv = check.perEnvironment;
    // The per-assignment selector (absent = `null` = all current environments).
    const environmentIds = check.environmentIds;

    // A live env slice is one still in the system AND still selected by the
    // assignment - so disabling an env for THIS assignment makes its slice
    // stale even though the env remains part of the system.
    const hasLiveEnvSlice = (perEnv ?? []).some(
      (pe) =>
        pe.environmentId !== null &&
        isConcreteEnvLive({
          environmentId: pe.environmentId,
          currentEnvIds,
          environmentIds,
        }),
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
        isSliceOrphaned({
          environmentId,
          currentEnvIds,
          environmentIds,
          hasLiveEnvSlice,
          recentRuns: only?.recentRuns ?? check.recentRuns,
          intervalSeconds: check.intervalSeconds,
          now,
        });
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
          environmentIds,
          hasLiveEnvSlice,
          recentRuns: pe.recentRuns,
          intervalSeconds: check.intervalSeconds,
          now,
        }),
      });
    }
  }

  // Stable-sort so the list does not reshuffle as check health updates.
  rows.sort(compareOverviewRows);

  return rows;
}
