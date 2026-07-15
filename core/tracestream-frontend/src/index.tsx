import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { Waypoints } from "lucide-react";
import { LogEventDetailSlot } from "@checkstack/logstream-common";
import { RunDetailExtrasSlot } from "@checkstack/healthcheck-common";
import { HealthCheckConfigOptionsResolverSlot } from "@checkstack/healthcheck-frontend";
import { SystemDetailsSlot, SystemSignalsSlot } from "@checkstack/catalog-common";
import {
  tracestreamRoutes,
  pluginMetadata,
  tracestreamAccess,
  tracestreamResourceTypes,
  TRACESTREAM_ACTIVITY,
  TRACESTREAM_IMPORTANT_EVENT,
  TRACESTREAM_STRATEGY_ID,
} from "@checkstack/tracestream-common";
import { buildTracestreamOptionsResolvers } from "./health-options-resolvers";
import { ViewTraceForLogEvent } from "./components/ViewTraceForLogEvent";
import { ViewTraceForRun } from "./components/ViewTraceForRun";

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
 * (signal "traces"), so telemetry sources can bind a trace stream. The
 * healthcheck strategy picker is wired below via the
 * `HealthCheckConfigOptionsResolverSlot` fill (stream / service / operation
 * dropdown resolvers for the `tracestream` strategy's config + collector forms).
 */
export default createFrontendPlugin({
  metadata: pluginMetadata,
  signals: [TRACESTREAM_ACTIVITY, TRACESTREAM_IMPORTANT_EVENT],
  // Cross-plugin "View trace" jumps: tracestream fills the log-event detail and
  // health-check run-detail slots. Each filler gates on a present trace id
  // before querying and self-hides when the id resolves to no readable trace.
  extensions: [
    createSlotExtension(LogEventDetailSlot, {
      id: "tracestream.log-event-view-trace",
      component: ViewTraceForLogEvent,
    }),
    createSlotExtension(RunDetailExtrasSlot, {
      id: "tracestream.run-view-trace",
      component: ViewTraceForRun,
    }),
    // Contribute the stream / service / operation dropdown resolvers for the
    // `tracestream` health-check strategy's config + collector fields. The
    // editor reads the metadata; the component is never rendered (metadata-only
    // contribution).
    createSlotExtension(HealthCheckConfigOptionsResolverSlot, {
      id: "tracestream.health-config-options-resolvers",
      component: () => null,
      metadata: {
        strategyId: TRACESTREAM_STRATEGY_ID,
        buildResolvers: buildTracestreamOptionsResolvers,
      },
    }),
    // Catalog system detail: a compact "Traces" card of the streams linked to
    // the system (self-hides when none). Lazy so it stays out of the initial
    // bundle and loads when a system-detail page renders.
    createSlotExtension(SystemDetailsSlot, {
      id: "tracestream.system-details.traces",
      load: () =>
        import("./components/TraceSystemLinksCard").then((m) => ({
          default: m.TraceSystemLinksCard,
        })),
    }),
    // Dashboard "needs attention" overview: report linked streams' recent
    // error-spike / silence events as per-system signals. Lazy: only loads when
    // the dashboard overview mounts the slot.
    createSlotExtension(SystemSignalsSlot, {
      id: "tracestream.dashboard.signals",
      load: () =>
        import("./components/TraceSignalsFiller").then((m) => ({
          default: m.TraceSignalsFiller,
        })),
    }),
  ],
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
