import type { AuthUser } from "@checkstack/backend-api";
import {
  principalGrantedRuleIds,
  type SystemSignalsContributor,
} from "@checkstack/ai-backend";
import { isAccessRuleSatisfied } from "@checkstack/common";
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
 *
 * PER-SOURCE access is OUR responsibility: gate the originating principal on
 * anomaly's own read rule and return `{}` (NEVER throw) when it is missing.
 * Service users are trusted backend-to-backend callers. The read is GLOBAL and
 * resolves from shared Postgres, so every pod returns the same answer, and the
 * shared {@link deriveAnomalySignals} mapper keeps the signals identical to the
 * frontend filler's.
 */
export const createAnomalySignalsContributor = ({
  service,
}: {
  service: SignalSource;
}): SystemSignalsContributor => ({
  sourceId: ANOMALY_SIGNAL_SOURCE_ID,
  read: async ({ principal }: { principal: AuthUser }) => {
    if (
      !isAccessRuleSatisfied(
        principalGrantedRuleIds(principal),
        anomalyAccess.feed.read,
      )
    ) {
      return {};
    }
    const rows = await service.getActiveSignalAnomalies();
    return deriveAnomalySignals({ rows });
  },
});
