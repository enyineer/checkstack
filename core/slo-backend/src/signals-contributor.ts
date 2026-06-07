import {
  createGatedSystemSignalsContributor,
  type SystemAccessResolver,
  type SystemSignalsContributor,
} from "@checkstack/ai-backend";
import {
  deriveSloSignals,
  sloAccess,
  SLO_SIGNAL_SOURCE_ID,
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
 * Build the SLO contributor for the AI `system.issues` aggregator. Reads every
 * objective globally, computes status, and runs the SAME deriver the frontend
 * filler uses. The per-source access gate (global `slo.read` plus per-system
 * team grants) is applied by {@link createGatedSystemSignalsContributor}.
 */
export function createSloSignalsContributor({
  service,
  engine,
  resolver,
}: {
  service: SloService;
  engine: SloEngine;
  resolver: SystemAccessResolver;
}): SystemSignalsContributor {
  return createGatedSystemSignalsContributor({
    sourceId: SLO_SIGNAL_SOURCE_ID,
    accessRule: sloAccess.slo.read,
    resolver,
    readSignals: async () =>
      deriveSloSignals({
        rowsBySystemId: await readSloRowsBySystemId({ service, engine }),
      }),
  });
}
