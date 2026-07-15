import { useEffect } from "react";
import { resolveRoute } from "@checkstack/common";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import { LinkedStreamsCard } from "@checkstack/catalog-frontend";
import { Gauge } from "lucide-react";
import { MetricstreamApi, metricstreamRoutes } from "@checkstack/metricstream-common";

type SlotProps = SlotContext<typeof SystemDetailsSlot>;

/**
 * Compact "Metrics" card on the catalog system detail page: the metric streams
 * EXPLICITLY linked to this system, each deep-linking to the stream detail page.
 * The shared {@link LinkedStreamsCard} owns the chrome (opaque `bg-card`, empty
 * self-hide) shared across the three stream plugins; this filler only fetches
 * `listStreamsForSystem` (RLAC post-filtered to readable streams) and supplies
 * the route builder.
 */
export function MetricsSystemCard({ system, onLoadingChange }: SlotProps) {
  const client = usePluginClient(MetricstreamApi);
  const { data, isLoading } = client.listStreamsForSystem.useQuery({
    systemId: system.id,
  });

  // Report load state so the detail page reveals all overview cards together
  // instead of each popping in as its own fetch settles.
  useEffect(() => {
    onLoadingChange?.("metricstream.card", isLoading);
  }, [isLoading, onLoadingChange]);

  return (
    <LinkedStreamsCard
      title="Metrics"
      icon={Gauge}
      streams={data?.streams ?? []}
      buildHref={(streamId) =>
        resolveRoute(metricstreamRoutes.routes.detail, { streamId })
      }
    />
  );
}
