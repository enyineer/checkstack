import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { HealthCheckConfigOptionsResolverSlot } from "@checkstack/healthcheck-frontend";
import {
  SystemDetailsSlot,
  SystemSignalsSlot,
} from "@checkstack/catalog-common";
import { Gauge } from "lucide-react";
import {
  metricstreamRoutes,
  pluginMetadata,
  metricstreamAccess,
  metricstreamResourceTypes,
  METRICSTREAM_STRATEGY_ID,
  METRICSTREAM_ACTIVITY,
  METRICSTREAM_IMPORTANT_EVENT,
} from "@checkstack/metricstream-common";
import { buildMetricstreamOptionsResolvers } from "./health-options-resolvers";

/**
 * Metric stream frontend plugin. Phase B2 skeleton: the two routes and the
 * "Reliability" nav entry are wired with the correct access gating and
 * `manageCapability`, so team-scoped stream managers see the surface, and the
 * health-check config resolvers are contributed. The C3 agent fills the page
 * bodies.
 */
export default createFrontendPlugin({
  metadata: pluginMetadata,
  // Register the stream-scoped signals so the auto-invalidator narrows
  // invalidation to the ingesting stream (via each signal's `resourceKey`)
  // instead of refetching every open metricstream query on any stream's
  // activity. The list page opts its resource-agnostic summaries back into
  // whole-plugin refresh with `meta: { signalScope: "plugin" }`.
  signals: [METRICSTREAM_ACTIVITY, METRICSTREAM_IMPORTANT_EVENT],
  // Contribute the stream / metric-name / label dropdown resolvers for the
  // `metricstream` health-check strategy's config fields. The editor reads the
  // metadata; the component is never rendered (metadata-only contribution).
  extensions: [
    createSlotExtension(HealthCheckConfigOptionsResolverSlot, {
      id: "metricstream.health-config-options-resolvers",
      component: () => null,
      metadata: {
        strategyId: METRICSTREAM_STRATEGY_ID,
        buildResolvers: buildMetricstreamOptionsResolvers,
      },
    }),
    // Compact "Metrics" card on the catalog system detail page listing the
    // streams linked to the system. Lazy - only loads when a system-detail page
    // renders (and the card self-hides when the system has no linked streams).
    createSlotExtension(SystemDetailsSlot, {
      id: "metricstream.system-details.metrics",
      load: () =>
        import("./components/MetricsSystemCard").then((m) => ({
          default: m.MetricsSystemCard,
        })),
    }),
    // Headless dashboard signals filler: linked streams' scrape failures /
    // cardinality overflows. Lazy - only loads when the dashboard overview
    // mounts the slot.
    createSlotExtension(SystemSignalsSlot, {
      id: "metricstream.dashboard.signals",
      load: () =>
        import("./components/MetricSignalsFiller").then((m) => ({
          default: m.MetricSignalsFiller,
        })),
    }),
  ],
  routes: [
    {
      route: metricstreamRoutes.routes.home,
      load: () =>
        import("./pages/MetricStreamListPage").then((m) => ({
          default: m.MetricStreamListPage,
        })),
      title: "Metric Streams",
      // The list is a READ surface (create/tokens/settings are gated per-action
      // inside the pages). Streams are team-scopable, so a team read grant (no
      // global rule) must reveal the route: manageCapability admits grant-holders
      // of `metricstream.stream` even though the gate is read. The objectType
      // MUST be the team-scopable type - the CI guard checks it.
      accessRule: metricstreamAccess.read,
      manageCapability: {
        objectType: metricstreamResourceTypes.stream,
      },
      nav: {
        group: "Reliability",
        icon: Gauge,
        accessRule: metricstreamAccess.read,
      },
    },
    {
      route: metricstreamRoutes.routes.detail,
      load: () =>
        import("./pages/MetricStreamDetailPage").then((m) => ({
          default: m.MetricStreamDetailPage,
        })),
      title: "Metric Stream",
      accessRule: metricstreamAccess.read,
      manageCapability: {
        objectType: metricstreamResourceTypes.stream,
      },
    },
  ],
});

export * from "./api";
