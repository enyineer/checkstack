import { useState } from "react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { LogstreamApi, type LogStream } from "@checkstack/logstream-common";
import { StreamSettingsForm } from "../StreamSettingsForm";
import { SeverityRulesSection } from "../SeverityRulesSection";
import { TokensSection } from "../TokensSection";
import { ShipLogsInstructions } from "../ShipLogsInstructions";
import { DangerZoneSection } from "../DangerZoneSection";

export interface SettingsTabProps {
  stream: LogStream;
}

/**
 * Settings tab: stream details + policy, source tokens and ship-logs snippets.
 * Write controls are gated on the contract-derived `updateStream` verdict, so a
 * read-only viewer sees everything but cannot edit or mint.
 */
export function SettingsTab({ stream }: SettingsTabProps) {
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage } = accessApi.useProcedureAccess(
    LogstreamApi.contract.updateStream,
    { id: stream.id },
  );
  // A freshly-minted secret, offered to the setup snippets for this session only.
  const [mintedSecret, setMintedSecret] = useState<string | undefined>();

  return (
    <div className="space-y-6">
      <StreamSettingsForm stream={stream} canManage={canManage} />
      <SeverityRulesSection stream={stream} canManage={canManage} />
      <TokensSection
        streamId={stream.id}
        canManage={canManage}
        onMinted={setMintedSecret}
      />
      <ShipLogsInstructions token={mintedSecret} />
      <DangerZoneSection stream={stream} />
    </div>
  );
}
