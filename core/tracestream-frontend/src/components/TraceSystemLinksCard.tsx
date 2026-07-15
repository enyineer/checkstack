import { useEffect } from "react";
import { resolveRoute } from "@checkstack/common";
import {
  usePluginClient,
  type SlotContext,
} from "@checkstack/frontend-api";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import { LinkedStreamsCard } from "@checkstack/catalog-frontend";
import { Waypoints } from "lucide-react";
import {
  TracestreamApi,
  tracestreamRoutes,
} from "@checkstack/tracestream-common";

type SlotProps = SlotContext<typeof SystemDetailsSlot>;

/**
 * `SystemDetailsSlot` filler: a compact "Traces" card of the trace streams
 * explicitly linked to this system, deep-linking to each stream's detail page.
 * The chrome + self-hide-when-empty behaviour lives in the shared
 * {@link LinkedStreamsCard} (so the logs/metrics/traces cards on one system page
 * match); this filler only fetches `listStreamsForSystem` (RLAC post-filtered to
 * the caller's readable streams, so every offered link resolves).
 */
export function TraceSystemLinksCard({ system, onLoadingChange }: SlotProps) {
  const client = usePluginClient(TracestreamApi);
  const { data, isLoading } = client.listStreamsForSystem.useQuery({
    systemId: system.id,
  });

  // Report load state so the detail page reveals all overview cards together
  // instead of each popping in as its own fetch settles.
  useEffect(() => {
    onLoadingChange?.("tracestream.card", isLoading);
  }, [isLoading, onLoadingChange]);

  return (
    <LinkedStreamsCard
      title="Traces"
      icon={Waypoints}
      streams={data?.streams ?? []}
      buildHref={(streamId) =>
        resolveRoute(tracestreamRoutes.routes.detail, { streamId })
      }
    />
  );
}
