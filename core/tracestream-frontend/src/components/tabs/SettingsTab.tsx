import { useState } from "react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { TracestreamApi, type TraceStream } from "@checkstack/tracestream-common";
import { StreamSourcesSection } from "@checkstack/telemetry-frontend";
import { StreamSettingsForm } from "../StreamSettingsForm";
import { TokensSection } from "../TokensSection";
import { ShipTracesInstructions } from "../ShipTracesInstructions";
import { DangerZoneSection } from "../DangerZoneSection";

export interface SettingsTabProps {
  stream: TraceStream;
}

/**
 * Settings tab: sampling/caps/retention policy, source tokens, ship-traces
 * instructions and the danger zone. Write controls are gated on the
 * contract-derived `updateStream` verdict, so a read-only viewer sees the policy
 * but cannot edit. A freshly-minted token is passed straight into the
 * instructions so its snippets carry the real secret while it is still shown.
 */
export function SettingsTab({ stream }: SettingsTabProps) {
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage } = accessApi.useProcedureAccess(
    TracestreamApi.contract.updateStream,
    { id: stream.id },
  );
  const [mintedSecret, setMintedSecret] = useState<string | undefined>();

  return (
    <div className="space-y-6">
      <StreamSettingsForm stream={stream} canManage={canManage} />
      <TokensSection
        streamId={stream.id}
        canManage={canManage}
        onMinted={setMintedSecret}
      />
      <StreamSourcesSection signal="traces" streamId={stream.id} />
      <ShipTracesInstructions token={mintedSecret} />
      <DangerZoneSection stream={stream} />
    </div>
  );
}
