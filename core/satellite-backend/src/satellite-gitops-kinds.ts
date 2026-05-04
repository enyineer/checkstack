import { z } from "zod";
import {
  CHECKSTACK_API_VERSION,
  type EntityKindDefinition,
  type EntityKindRegistry,
  type ReconcileContext,
} from "@checkstack/gitops-common";
import type { SatelliteService } from "./service";

interface SatelliteGitOpsKindsDeps {
  /** Lazy accessor — populated during init(), invoked at reconcile time. */
  getService: () => SatelliteService;
}

// ─── Satellite Spec Schema ─────────────────────────────────────────────────
//
// GitOps owns metadata only — name, region, and the satellite's runtime
// tags (sourced from the envelope's `metadata.labels`, since the envelope
// already provides a `Record<string, string>` for that purpose). The bcrypt
// token is never committed to YAML; operators retrieve and reset tokens via
// the Satellites page in the UI.

const satelliteSpecSchema = z.object({
  region: z.string().min(1),
});

type SatelliteSpec = z.infer<typeof satelliteSpecSchema>;

export function buildSatelliteKind(
  deps: SatelliteGitOpsKindsDeps,
): EntityKindDefinition<SatelliteSpec> {
  return {
    apiVersion: CHECKSTACK_API_VERSION,
    kind: "Satellite",
    specSchema: satelliteSpecSchema,

    reconcile: async ({
      entity,
      existingEntityId,
      context,
    }: {
      entity: {
        metadata: {
          name: string;
          title?: string;
          description?: string;
          labels?: Record<string, string>;
        };
        spec: SatelliteSpec;
      };
      existingEntityId?: string;
      context: ReconcileContext;
    }) => {
      const service = deps.getService();
      const { spec, metadata } = entity;
      const tags = metadata.labels ?? {};

      // Try the provenance hint first; fall back to a name lookup so we
      // adopt pre-existing satellites that match by name on first sync.
      const existing =
        existingEntityId && !existingEntityId.startsWith("pending-")
          ? await service.getSatellite(existingEntityId)
          : await service.getSatelliteByName(metadata.name);

      if (existing) {
        const updated = await service.updateSatelliteMetadata({
          id: existing.id,
          name: metadata.name,
          region: spec.region,
          tags,
        });
        const finalId = updated?.id ?? existing.id;
        context.logger.info(
          `GitOps: updated Satellite "${metadata.name}" (id: ${finalId})`,
        );
        return { entityId: finalId };
      }

      // First-time create. The plaintext token is intentionally discarded —
      // an operator must use the UI's "Reset token" affordance to retrieve a
      // working token. This keeps the secret out of YAML and out of logs.
      const created = await service.createSatellite({
        name: metadata.name,
        region: spec.region,
        tags,
      });
      context.logger.info(
        `GitOps: created Satellite "${metadata.name}" (id: ${created.satellite.id}). ` +
          `Reset the token via the Satellites page to obtain a working credential.`,
      );
      return { entityId: created.satellite.id };
    },

    delete: async ({
      entityId,
      context,
    }: {
      entityName: string;
      entityId?: string;
      context: ReconcileContext;
    }) => {
      if (!entityId) return;
      await deps.getService().deleteSatellite(entityId);
      context.logger.info(`GitOps: deleted Satellite (id: ${entityId})`);
    },
  };
}

export function registerSatelliteGitOpsKinds({
  kindRegistry,
  ...deps
}: SatelliteGitOpsKindsDeps & {
  kindRegistry: EntityKindRegistry;
}): void {
  kindRegistry.registerKind(buildSatelliteKind(deps));
}
