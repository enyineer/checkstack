import { usePluginClient } from "@checkstack/frontend-api";
import { useToast, toastError } from "@checkstack/ui";
import { StreamSystemLinksSettingsCard } from "@checkstack/catalog-frontend";
import { MetricstreamApi, type MetricStream } from "@checkstack/metricstream-common";
import { useServiceNameSuggestions } from "../hooks/useServiceNameSuggestions";

export interface LinkedSystemsSectionProps {
  stream: MetricStream;
}

/**
 * Data wiring for the "Linked systems" settings section. The shared
 * {@link StreamSystemLinksSettingsCard} owns the draft + dirty + save-button
 * shell (identical across the three stream plugins); this component only wires
 * the metricstream RPCs: the links loader (seed-once, `gcTime: 0`), the gated
 * `setSystemLinks` mutation (its `allowed` verdict drives manageability), and
 * the observed `service.name` suggestions (sampled from metric label values).
 */
export function LinkedSystemsSection({ stream }: LinkedSystemsSectionProps) {
  const client = usePluginClient(MetricstreamApi);
  const toast = useToast();

  // `gcTime: 0` so a stale-while-revalidate entry cannot race the card's
  // one-shot seed (see query-invalidation.md).
  const { data: links } = client.listSystemLinks.useQuery(
    { streamId: stream.id },
    { gcTime: 0 },
  );

  const { serviceNames, loading: serviceNamesLoading } =
    useServiceNameSuggestions(stream.id);

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
      suggestions={{ serviceNames, loading: serviceNamesLoading }}
      description="Link this stream to the catalog systems it reports metrics for. Linked systems surface this stream on their detail page and turn its scrape failures and cardinality overflows into dashboard signals. Suggestions from observed service names are never applied automatically - click a chip to link that system."
    />
  );
}
