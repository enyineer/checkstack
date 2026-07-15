import { usePluginClient } from "@checkstack/frontend-api";
import { useToast, toastError } from "@checkstack/ui";
import { StreamSystemLinksSettingsCard } from "@checkstack/catalog-frontend";
import { LogstreamApi, type LogStream } from "@checkstack/logstream-common";

export interface LinkedSystemsSectionProps {
  stream: LogStream;
}

/**
 * Data wiring for the "Linked systems" settings section. The shared
 * {@link StreamSystemLinksSettingsCard} owns the draft + dirty + save-button
 * shell (identical across the three stream plugins); this component only wires
 * the logstream RPCs: the links loader (seed-once, `gcTime: 0`), the gated
 * `setSystemLinks` mutation (its `allowed` verdict drives manageability), and
 * the observed `service.name` suggestions.
 */
export function LinkedSystemsSection({ stream }: LinkedSystemsSectionProps) {
  const client = usePluginClient(LogstreamApi);
  const toast = useToast();

  // `gcTime: 0` so a stale-while-revalidate entry cannot race the card's
  // one-shot seed (see query-invalidation.md).
  const { data: links } = client.listSystemLinks.useQuery(
    { streamId: stream.id },
    { gcTime: 0 },
  );

  // Suggestions are a hint only. `staleTime: 60_000` so refocusing the window
  // does not re-run the (bounded 5k-row) service-name scan on every refocus.
  const { data: serviceNames, isPending: serviceNamesLoading } =
    client.listServiceNames.useQuery(
      { streamId: stream.id },
      { staleTime: 60_000 },
    );

  const saveMutation = client.setSystemLinks.useGatedMutation({
    gateInput: { streamId: stream.id },
    onSuccess: () => toast.success("Linked systems saved"),
    onError: (error) => toastError(toast, "Failed to save linked systems", error),
  });

  return (
    <StreamSystemLinksSettingsCard
      streamKey={stream.id}
      savedSystemIds={links?.systemIds}
      onSave={(systemIds) => saveMutation.mutate({ streamId: stream.id, systemIds })}
      saving={saveMutation.isPending}
      canManage={saveMutation.allowed}
      suggestions={{
        serviceNames: serviceNames?.serviceNames ?? [],
        loading: serviceNamesLoading,
      }}
      description="Link this stream to the catalog systems it produces logs for. Linked systems surface this stream on their detail page and turn its error spikes into dashboard signals. Suggestions from observed service names are never applied automatically - click a chip to link that system."
    />
  );
}
