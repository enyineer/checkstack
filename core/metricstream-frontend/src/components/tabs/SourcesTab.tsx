import { useState } from "react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { MetricstreamApi, type MetricStream } from "@checkstack/metricstream-common";
import { StreamSourcesSection } from "@checkstack/telemetry-frontend";
import { PushEndpointsCard } from "../PushEndpointsCard";
import { TokensSection } from "../TokensSection";
import { ScrapeTargetsSection } from "../ScrapeTargetsSection";

export interface SourcesTabProps {
  stream: MetricStream;
}

/**
 * Sources tab: push-endpoint snippets, source-token management and Prometheus
 * scrape targets. Write controls are gated on the contract-derived
 * `updateStream` verdict, so a read-only viewer sees the endpoints but cannot
 * mint tokens or edit targets.
 */
export function SourcesTab({ stream }: SourcesTabProps) {
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage } = accessApi.useProcedureAccess(
    MetricstreamApi.contract.updateStream,
    { id: stream.id },
  );
  // A freshly-minted secret, offered to the push snippets for this session only.
  const [mintedSecret, setMintedSecret] = useState<string | undefined>();

  return (
    <div className="space-y-6">
      <PushEndpointsCard token={mintedSecret} />
      <TokensSection
        streamId={stream.id}
        canManage={canManage}
        onMinted={setMintedSecret}
      />
      <ScrapeTargetsSection streamId={stream.id} canManage={canManage} />
      <StreamSourcesSection signal="metrics" streamId={stream.id} />
    </div>
  );
}
