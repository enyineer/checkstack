import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { MetricstreamApi, type MetricStream } from "@checkstack/metricstream-common";
import { StreamSettingsForm } from "../StreamSettingsForm";
import { LinkedSystemsSection } from "../LinkedSystemsSection";
import { DangerZoneSection } from "../DangerZoneSection";

export interface SettingsTabProps {
  stream: MetricStream;
}

/**
 * Settings tab: caps/retention policy and the danger zone. Write controls are
 * gated on the contract-derived `updateStream` verdict, so a read-only viewer
 * sees the policy but cannot edit or delete.
 */
export function SettingsTab({ stream }: SettingsTabProps) {
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage } = accessApi.useProcedureAccess(
    MetricstreamApi.contract.updateStream,
    { id: stream.id },
  );

  return (
    <div className="space-y-6">
      <StreamSettingsForm stream={stream} canManage={canManage} />
      <LinkedSystemsSection stream={stream} />
      <DangerZoneSection stream={stream} />
    </div>
  );
}
