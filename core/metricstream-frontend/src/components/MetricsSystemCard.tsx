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
export function MetricsSystemCard({ system }: SlotProps) {
  const client = usePluginClient(MetricstreamApi);
  const { data } = client.listStreamsForSystem.useQuery({ systemId: system.id });

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
