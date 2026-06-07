import type { AuthUser } from "@checkstack/backend-api";
import { principalGrantedRuleIds } from "@checkstack/ai-backend";
import type { SystemSignalsMap } from "@checkstack/catalog-common";
import { isAccessRuleSatisfied } from "@checkstack/common";
import {
  deriveSloSignals,
  sloAccess,
  type SloSignalRow,
} from "@checkstack/slo-common";
import type { SloService } from "./service";
import type { SloEngine } from "./slo-engine";

/**
 * Global read for the `system.issues` SLO contributor: load EVERY objective
 * (across all systems) from shared, durable storage and compute its current
 * status, grouped by systemId. Pod-independent - every pod reads the same
 * `slo_objectives` rows and computes status the same way.
 */
async function readSloRowsBySystemId({
  service,
  engine,
}: {
  service: SloService;
  engine: SloEngine;
}): Promise<Record<string, SloSignalRow[]>> {
  const objectives = await service.listObjectives();
  const rowsBySystemId: Record<string, SloSignalRow[]> = {};

  await Promise.all(
    objectives.map(async (objective) => {
      const status = await engine.computeStatus({ objective });
      (rowsBySystemId[objective.systemId] ??= []).push({ objective, status });
    }),
  );

  return rowsBySystemId;
}

/**
 * Build the `read` callback for the SLO system-signals contributor. Enforces
 * this source's own read access against the originating principal (returns `{}`
 * - never throws - when the principal cannot see SLOs), then derives identical
 * signals to the frontend filler via the shared {@link deriveSloSignals}.
 */
export function createSloSignalsRead({
  service,
  engine,
}: {
  service: SloService;
  engine: SloEngine;
}): (context: { principal: AuthUser }) => Promise<SystemSignalsMap> {
  return async ({ principal }) => {
    // Per-source access gate. `principalGrantedRuleIds` treats a trusted service
    // principal as wildcard; user/application principals must satisfy the rule.
    if (
      !isAccessRuleSatisfied(principalGrantedRuleIds(principal), sloAccess.slo.read)
    ) {
      return {};
    }

    const rowsBySystemId = await readSloRowsBySystemId({ service, engine });
    return deriveSloSignals({ rowsBySystemId });
  };
}
