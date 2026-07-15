import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { TracestreamApi, type TraceStream } from "@checkstack/tracestream-common";
import { StreamSettingsForm } from "../StreamSettingsForm";
import { LinkedSystemsSection } from "../LinkedSystemsSection";
import { DangerZoneSection } from "../DangerZoneSection";

export interface SettingsTabProps {
  stream: TraceStream;
}

/**
 * Settings tab: sampling/caps/retention policy, linked systems and the danger
 * zone. Write controls are gated on the contract-derived `updateStream` verdict,
 * so a read-only viewer sees the policy but cannot edit. Telemetry sources (push
 * tokens + ship-traces snippets, owned by the platform via `tracestream.push`
 * instances) live in the dedicated Sources tab, not here.
 */
export function SettingsTab({ stream }: SettingsTabProps) {
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage } = accessApi.useProcedureAccess(
    TracestreamApi.contract.updateStream,
    { id: stream.id },
  );

  return (
    <div className="space-y-6">
      <StreamSettingsForm stream={stream} canManage={canManage} />
      <LinkedSystemsSection streamId={stream.id} />
      <DangerZoneSection stream={stream} />
    </div>
  );
}
