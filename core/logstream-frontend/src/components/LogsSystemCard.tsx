import { useEffect } from "react";
import { resolveRoute } from "@checkstack/common";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import { LinkedStreamsCard } from "@checkstack/catalog-frontend";
import { ScrollText } from "lucide-react";
import { LogstreamApi, logstreamRoutes } from "@checkstack/logstream-common";

type SlotProps = SlotContext<typeof SystemDetailsSlot>;

/**
 * Compact "Logs" card on the catalog system detail page: the log streams
 * EXPLICITLY linked to this system, each deep-linking to the stream detail page.
 * The shared {@link LinkedStreamsCard} owns the chrome (opaque `bg-card`, empty
 * self-hide) shared across the three stream plugins; this filler only fetches
 * `listStreamsForSystem` (RLAC post-filtered to readable streams) and supplies
 * the route builder.
 */
export function LogsSystemCard({ system, onLoadingChange }: SlotProps) {
  const client = usePluginClient(LogstreamApi);
  const { data, isLoading } = client.listStreamsForSystem.useQuery({
    systemId: system.id,
  });

  // Report load state so the detail page reveals all overview cards together
  // instead of each popping in as its own fetch settles.
  useEffect(() => {
    onLoadingChange?.("logstream.card", isLoading);
  }, [isLoading, onLoadingChange]);

  return (
    <LinkedStreamsCard
      title="Logs"
      icon={ScrollText}
      streams={data?.streams ?? []}
      buildHref={(streamId) =>
        resolveRoute(logstreamRoutes.routes.detail, { streamId })
      }
    />
  );
}
