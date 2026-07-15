import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { LogstreamApi, type LogStream } from "@checkstack/logstream-common";
import { StreamSettingsForm } from "../StreamSettingsForm";
import { SeverityRulesSection } from "../SeverityRulesSection";
import { TraceExtractionSection } from "../TraceExtractionSection";
import { LinkedSystemsSection } from "../LinkedSystemsSection";
import { DangerZoneSection } from "../DangerZoneSection";

export interface SettingsTabProps {
  stream: LogStream;
}

/**
 * Settings tab: stream details + policy and linked systems. Log ingest (push
 * tokens, OTLP/native snippets, syslog, pull) lives on the dedicated Sources
 * tab now, owned by the platform. Write controls are gated on the
 * contract-derived `updateStream` verdict, so a read-only viewer sees everything
 * but cannot edit.
 */
export function SettingsTab({ stream }: SettingsTabProps) {
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage } = accessApi.useProcedureAccess(
    LogstreamApi.contract.updateStream,
    { id: stream.id },
  );

  return (
    <div className="space-y-6">
      <StreamSettingsForm stream={stream} canManage={canManage} />
      <LinkedSystemsSection stream={stream} />
      <SeverityRulesSection stream={stream} canManage={canManage} />
      <TraceExtractionSection stream={stream} canManage={canManage} />
      <DangerZoneSection stream={stream} />
    </div>
  );
}
