import { usePluginClient } from "@checkstack/frontend-api";
import { GitOpsApi } from "@checkstack/gitops-common";

/**
 * Hook to check if a catalog entity is managed by GitOps.
 *
 * Returns provenance data and loading state so callers can
 * disable editing and show a lock banner.
 *
 * @param params.kind - Entity kind (e.g. "System", "Group")
 * @param params.entityId - Plugin-specific entity ID (e.g. catalog system UUID)
 */
export const useProvenanceLock = (params: {
  kind: string;
  entityId: string | undefined;
}) => {
  const gitopsClient = usePluginClient(GitOpsApi);

  const { data: provenance, isLoading } = gitopsClient.getProvenance.useQuery(
    { kind: params.kind, entityId: params.entityId! },
    { enabled: !!params.entityId },
  );

  return {
    /** Whether this entity is managed by GitOps */
    isLocked: !!provenance && provenance.status === "synced",
    /** Full provenance data (or null) */
    provenance,
    /** Whether the provenance query is still loading */
    isLoading,
  };
};
