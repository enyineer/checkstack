import { useMemo } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { GitOpsApi, type Provenance } from "@checkstack/gitops-common";

export interface ProvenanceLock {
  isLocked: boolean;
  provenance: Provenance | null;
}

const lockKey = ({ kind, entityId }: { kind: string; entityId: string }) =>
  `${kind}::${entityId}`;

/**
 * Bulk variant of `useProvenanceLock`. Issues a single `listProvenance` query
 * for the whole tenant and returns a `getLock(kind, entityId)` lookup, so
 * callers rendering many rows can avoid an N-query fan-out.
 */
export const useProvenanceLocks = () => {
  const gitopsClient = usePluginClient(GitOpsApi);

  const { data: provenances, isLoading } =
    gitopsClient.listProvenance.useQuery();

  const lockMap = useMemo(() => {
    const map = new Map<string, Provenance>();
    for (const p of provenances ?? []) {
      if (p.status !== "synced") continue;
      map.set(lockKey({ kind: p.kind, entityId: p.entityId }), p);
    }
    return map;
  }, [provenances]);

  const getLock = (params: {
    kind: string;
    entityId: string | undefined;
  }): ProvenanceLock => {
    if (!params.entityId) return { isLocked: false, provenance: null };
    const provenance = lockMap.get(lockKey({ kind: params.kind, entityId: params.entityId })) ?? null;
    return { isLocked: !!provenance, provenance };
  };

  return { getLock, isLoading };
};
