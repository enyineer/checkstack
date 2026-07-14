import { useMemo, useState } from "react";
import { usePluginClient, useApi, accessApiRef } from "@checkstack/frontend-api";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  EmptyState,
} from "@checkstack/ui";
import { Antenna, Plus } from "lucide-react";
import {
  TelemetryApi,
  telemetryAccess,
  telemetryResourceTypes,
  type TelemetrySignal,
} from "@checkstack/telemetry-common";
import {
  indexSourceTypes,
  shouldHideSourcesSection,
} from "../lib/sources-section.logic";
import { SourceInstanceList } from "./SourceInstanceList";
import { AddSourceDialog } from "./AddSourceDialog";

export interface StreamSourcesSectionProps {
  /** The telemetry signal this stream owns (logs / metrics / traces). */
  signal: TelemetrySignal;
  /** The owning stream's id, used as the binding target for new sources. */
  streamId: string;
}

/**
 * Embeddable "Sources" section for a stream detail page. Lists the telemetry
 * source instances bound to this stream for its signal and lets managers add,
 * edit, delete, test and (for webhook types) rotate them.
 *
 * SELF-HIDING: renders nothing when the signal has no contributed source types
 * AND the stream has no bound sources, so a stream page shows no empty shell
 * before any source type ships. Mount it unconditionally; it decides.
 */
export function StreamSourcesSection({
  signal,
  streamId,
}: StreamSourcesSectionProps) {
  const client = usePluginClient(TelemetryApi);
  const accessApi = useApi(accessApiRef);
  const [addOpen, setAddOpen] = useState(false);

  const { data: typesData, isLoading: typesLoading } =
    client.listSourceTypes.useQuery({ signal });
  const { data: sourcesData, isLoading: sourcesLoading } =
    client.listSources.useQuery({ streamId, signal });

  const sourceTypes = useMemo(
    () => typesData?.sourceTypes ?? [],
    [typesData],
  );
  const sources = useMemo(() => sourcesData?.sources ?? [], [sourcesData]);
  const typeIndex = useMemo(
    () => indexSourceTypes(sourceTypes),
    [sourceTypes],
  );

  const { allowed: canCreate } = accessApi.useProcedureAccess(
    TelemetryApi.contract.createSource,
  );
  const resourceIds = useMemo(() => sources.map((s) => s.id), [sources]);
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: telemetryAccess.manage,
    objectType: telemetryResourceTypes.source,
    resourceIds,
  });

  // Don't flash an empty shell while the first load resolves; decide once data
  // is in. Both queries filter by signal, so this is a pure emptiness check.
  if (typesLoading || sourcesLoading) return null;
  if (shouldHideSourcesSection({ sourceTypes, sources })) return null;

  return (
    <Card>
      <CardHeader>
        <CardHeaderRow>
          <div>
            <CardTitle>Sources</CardTitle>
            <CardDescription>
              Pluggable sources that ingest telemetry into this stream, whether
              polled on a schedule or pushed to a webhook endpoint.
            </CardDescription>
          </div>
          {canCreate && sourceTypes.length > 0 && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add source
            </Button>
          )}
        </CardHeaderRow>
      </CardHeader>
      <CardContent>
        {sources.length === 0 ? (
          <EmptyState
            icon={<Antenna className="h-6 w-6" />}
            title="No sources yet"
            description="Add a source to pull or receive telemetry into this stream."
            actions={
              canCreate && sourceTypes.length > 0 ? (
                <Button onClick={() => setAddOpen(true)}>
                  <Plus className="size-4" />
                  Add source
                </Button>
              ) : undefined
            }
          />
        ) : (
          <SourceInstanceList
            sources={sources}
            typeIndex={typeIndex}
            canManage={canAccess}
          />
        )}
      </CardContent>

      <AddSourceDialog
        signal={signal}
        streamId={streamId}
        sourceTypes={sourceTypes}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </Card>
  );
}
