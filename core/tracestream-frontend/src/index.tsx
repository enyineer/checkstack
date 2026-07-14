import { createFrontendPlugin } from "@checkstack/frontend-api";
import { Waypoints } from "lucide-react";
import {
  tracestreamRoutes,
  pluginMetadata,
  tracestreamAccess,
  tracestreamResourceTypes,
  TRACESTREAM_ACTIVITY,
  TRACESTREAM_IMPORTANT_EVENT,
} from "@checkstack/tracestream-common";

/**
 * Trace stream frontend plugin. Wires the list + detail routes under the
 * "Reliability" nav group with read gating and `manageCapability` on the
 * team-scopable `stream` type (so a team read-grant reveals the surface), and
 * registers the stream-scoped signals so the auto-invalidator narrows
 * invalidation to the ingesting stream (via each signal's `resourceKey`). The
 * list page opts its resource-agnostic summaries back into whole-plugin refresh
 * with `meta: { signalScope: "plugin" }`.
 *
 * NOTE: the Settings tab now embeds the telemetry `StreamSourcesSection`
 * (signal "traces"), so telemetry sources can bind a trace stream. Still pending:
 * the healthcheck strategy picker - add the `HealthCheckConfigOptionsResolverSlot`
 * extension + `listStreamsForPicker` resolver here when that ships.
 */
export default createFrontendPlugin({
  metadata: pluginMetadata,
  signals: [TRACESTREAM_ACTIVITY, TRACESTREAM_IMPORTANT_EVENT],
  routes: [
    {
      route: tracestreamRoutes.routes.home,
      load: () =>
        import("./pages/TraceStreamListPage").then((m) => ({
          default: m.TraceStreamListPage,
        })),
      title: "Trace Streams",
      // A READ surface (create/tokens/settings are gated per-action inside the
      // pages). Streams are team-scopable, so a team read grant (no global rule)
      // must reveal the route: manageCapability admits grant-holders of
      // `tracestream.stream`. The objectType MUST be the team-scopable type -
      // the CI guard checks it.
      accessRule: tracestreamAccess.read,
      manageCapability: {
        objectType: tracestreamResourceTypes.stream,
      },
      nav: {
        group: "Reliability",
        icon: Waypoints,
        accessRule: tracestreamAccess.read,
      },
    },
    {
      route: tracestreamRoutes.routes.detail,
      load: () =>
        import("./pages/TraceStreamDetailPage").then((m) => ({
          default: m.TraceStreamDetailPage,
        })),
      title: "Trace Stream",
      accessRule: tracestreamAccess.read,
      manageCapability: {
        objectType: tracestreamResourceTypes.stream,
      },
    },
  ],
});

export * from "./api";
