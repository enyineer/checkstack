import type { AccessRule } from "@checkstack/common";
import type {
  SystemSignal,
  SystemSignalsMap,
} from "@checkstack/catalog-common";
import type { AnomalyState } from "./schema";

/**
 * Stable source id under which anomaly signals are reported, both to the
 * dashboard {@link SystemSignalsSlot} (frontend) and the `system.issues`
 * backend aggregator. MUST match the contributor's `sourceId`.
 */
export const ANOMALY_SIGNAL_SOURCE_ID = "anomaly";

/**
 * The minimal anomaly-row shape the signal deriver needs. Both the frontend
 * filler (from the `getAnomalies` RPC rows) and the backend contributor (from
 * the service rows) project their data down to this before deriving signals, so
 * the produced signals are identical on both sides.
 */
export interface AnomalySignalRow {
  systemId: string;
  configurationId: string;
  fieldPath: string;
  /** ISO timestamp the anomaly started. */
  startedAt: string;
  /** Drives the signal tone and label. */
  state: AnomalyState;
}

/**
 * Per-state tone/label mapping. Only the two "problem" states surface a signal;
 * `recovered` rows produce nothing (and are filtered out by the deriver).
 */
const STATE_SIGNAL: Record<
  AnomalyState,
  { tone: SystemSignal["tone"]; label: string } | undefined
> = {
  anomaly: { tone: "warn", label: "Anomaly detected" },
  suspicious: { tone: "info", label: "Suspicious behaviour" },
  recovered: undefined,
};

/**
 * Pure, dependency-free deriver shared by the frontend dashboard filler and the
 * backend `system.issues` contributor. Maps anomaly rows into a
 * {@link SystemSignalsMap}, emitting one signal per problem row (confirmed
 * anomalies as `warn`, suspicious rows as `info`). Recovered rows are skipped,
 * so only systems with a current problem appear in the result.
 *
 * The `href`/`accessRule` that deep-link a signal to the affected check's
 * history live in `@checkstack/healthcheck-common`. To keep this deriver free of
 * a healthcheck dependency, callers inject `buildHref` (resolves the history
 * route for a row) and `accessRule` (the rule gating that page). The backend
 * aggregator drops both fields anyway, so a backend caller may pass an
 * `href`-less builder; the frontend passes the resolved history route so its
 * output is unchanged.
 */
export const deriveAnomalySignals = ({
  rows,
  buildHref,
  accessRule,
}: {
  rows: AnomalySignalRow[];
  buildHref?: (row: AnomalySignalRow) => string | undefined;
  accessRule?: AccessRule;
}): SystemSignalsMap => {
  const result: SystemSignalsMap = {};

  for (const row of rows) {
    const mapping = STATE_SIGNAL[row.state];
    if (!mapping) continue;

    const signal: SystemSignal = {
      source: ANOMALY_SIGNAL_SOURCE_ID,
      tone: mapping.tone,
      label: mapping.label,
      detail: row.fieldPath,
      href: buildHref?.(row),
      accessRule,
      since: new Date(row.startedAt).toISOString(),
      iconName: "ChartSpline",
    };
    (result[row.systemId] ??= []).push(signal);
  }

  return result;
};
