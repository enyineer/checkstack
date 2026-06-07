import {
  createGatedSystemSignalsContributor,
  type SystemAccessResolver,
  type SystemSignalsContributor,
} from "@checkstack/ai-backend";
import {
  anomalyAccess,
  deriveAnomalySignals,
  ANOMALY_SIGNAL_SOURCE_ID,
} from "@checkstack/anomaly-common";
import type { AnomalyService } from "./service";

/**
 * The slice of {@link AnomalyService} the contributor needs - the single global
 * read of current problem rows. Narrowed so the contributor (and its test) does
 * not depend on the full service surface.
 */
type SignalSource = Pick<AnomalyService, "getActiveSignalAnomalies">;

/**
 * Build the anomaly contributor for the dashboard `system.issues` aggregator.
 * Reads active (anomaly/suspicious) rows globally from shared Postgres and runs
 * the SAME deriver the frontend filler uses. The per-source access gate (global
 * `anomaly.feed.read` plus per-system team grants) is applied by
 * {@link createGatedSystemSignalsContributor}.
 */
export const createAnomalySignalsContributor = ({
  service,
  resolver,
}: {
  service: SignalSource;
  resolver: SystemAccessResolver;
}): SystemSignalsContributor =>
  createGatedSystemSignalsContributor({
    sourceId: ANOMALY_SIGNAL_SOURCE_ID,
    accessRule: anomalyAccess.feed.read,
    resolver,
    readSignals: async () =>
      deriveAnomalySignals({ rows: await service.getActiveSignalAnomalies() }),
  });
