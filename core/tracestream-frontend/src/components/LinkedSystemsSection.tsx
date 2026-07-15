import { useMemo } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { useToast, toastError } from "@checkstack/ui";
import { StreamSystemLinksSettingsCard } from "@checkstack/catalog-frontend";
import { TracestreamApi } from "@checkstack/tracestream-common";

export interface LinkedSystemsSectionProps {
  streamId: string;
}

/**
 * "Linked systems" settings section: explicit links from this trace stream to
 * catalog systems. All the draft / dirty / save-button chrome lives in the
 * shared {@link StreamSystemLinksSettingsCard} (so the three stream plugins
 * cannot drift); this wrapper only supplies the tracestream RPC - the saved set
 * (`listSystemLinks`, loaded `gcTime: 0` so a background refetch never races the
 * card's one-shot seed), the observed `service.name` suggestions
 * (`listServices`), and the gated `setSystemLinks` mutation.
 */
export function LinkedSystemsSection({ streamId }: LinkedSystemsSectionProps) {
  const client = usePluginClient(TracestreamApi);
  const toast = useToast();

  const { data: linksData } = client.listSystemLinks.useQuery(
    { streamId },
    { gcTime: 0 },
  );
  const { data: servicesData, isLoading: servicesLoading } =
    client.listServices.useQuery(
      { streamId },
      // Suggestions only; the observed service set changes slowly, so avoid a
      // refetch storm while the editor is open.
      { staleTime: 60_000 },
    );

  const saveMutation = client.setSystemLinks.useGatedMutation({
    gateInput: { streamId },
    onSuccess: () => toast.success("Linked systems saved"),
    onError: (error) =>
      toastError(toast, "Failed to save linked systems", error),
  });

  const suggestions = useMemo(
    () => ({
      serviceNames: servicesData?.services.map((s) => s.serviceName) ?? [],
      loading: servicesLoading,
    }),
    [servicesData, servicesLoading],
  );

  return (
    <StreamSystemLinksSettingsCard
      streamKey={streamId}
      savedSystemIds={linksData?.systemIds}
      onSave={(systemIds) => saveMutation.mutate({ streamId, systemIds })}
      saving={saveMutation.isPending}
      canManage={saveMutation.allowed}
      suggestions={suggestions}
      description="Link this trace stream to the catalog systems it reports for. Linked systems surface this stream on their detail page and in the dashboard."
    />
  );
}
