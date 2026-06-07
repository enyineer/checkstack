import { resolveRoute } from "@checkstack/common";
import type {
  SystemSignal,
  SystemSignalsMap,
} from "@checkstack/catalog-common";
import { sloAccess } from "./access";
import { sloRoutes } from "./routes";
import type { SloObjective, SloStatus } from "./schemas";

/**
 * Stable source id for SLO-derived dashboard signals. Shared by the frontend
 * {@link SystemSignalsSlot} filler and the backend `system.issues` contributor
 * so both attribute SLO problems to the same source.
 */
export const SLO_SIGNAL_SOURCE_ID = "slo";

/**
 * Error budget remaining (in percent) at or below which an otherwise-healthy
 * objective is reported as "at risk".
 */
export const SLO_AT_RISK_BUDGET_PERCENT = 20;

/**
 * One already-fetched SLO objective plus its computed status - the unit the
 * bulk RPC returns and the contributor's global query produces. This is exactly
 * the `{ objective, status }` row the dashboard filler iterates over.
 */
export interface SloSignalRow {
  objective: SloObjective;
  status: SloStatus;
}

/**
 * Pure deriver: maps a single objective row to a problem {@link SystemSignal},
 * or `null` when the objective is healthy (no signal). Shared by the frontend
 * filler and the backend contributor so both emit byte-identical signals.
 */
function deriveSloSignal({
  objective,
  status,
}: SloSignalRow): SystemSignal | null {
  let tone: SystemSignal["tone"];
  let label: string;
  if (status.isBreaching) {
    tone = "error";
    label = "SLO breaching";
  } else if (status.hasOpenDowntime) {
    tone = "warn";
    label = "SLO degraded";
  } else if (status.errorBudgetRemainingPercent <= SLO_AT_RISK_BUDGET_PERCENT) {
    tone = "warn";
    label = "SLO at risk";
  } else {
    return null;
  }

  return {
    source: SLO_SIGNAL_SOURCE_ID,
    tone,
    label,
    detail: `${objective.target}% target over ${objective.windowDays}d`,
    href: resolveRoute(sloRoutes.routes.detail, { sloId: objective.id }),
    // Detail page is read-gated; render as text for users without it.
    accessRule: sloAccess.slo.read,
    iconName: "Target",
  };
}

/**
 * Pure deriver: turns already-fetched objective rows (keyed by systemId) into a
 * {@link SystemSignalsMap}. Only systems with at least one problem objective
 * appear in the result; healthy systems (and systems with no problem signals)
 * are omitted. Dependency-free and pod-independent - the caller owns the data
 * fetch and access scoping.
 */
export function deriveSloSignals({
  rowsBySystemId,
}: {
  rowsBySystemId: Record<string, SloSignalRow[]>;
}): SystemSignalsMap {
  const result: SystemSignalsMap = {};

  for (const [systemId, rows] of Object.entries(rowsBySystemId)) {
    const systemSignals: SystemSignal[] = [];
    for (const row of rows) {
      const signal = deriveSloSignal(row);
      if (signal) systemSignals.push(signal);
    }
    if (systemSignals.length > 0) result[systemId] = systemSignals;
  }

  return result;
}
