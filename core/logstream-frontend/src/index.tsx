import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { HealthCheckConfigOptionsResolverSlot } from "@checkstack/healthcheck-frontend";
import { TraceCorrelationsSlot } from "@checkstack/tracestream-common";
import {
  SystemDetailsSlot,
  SystemSignalsSlot,
} from "@checkstack/catalog-common";
import { ScrollText } from "lucide-react";
import {
  logstreamRoutes,
  pluginMetadata,
  logstreamAccess,
  logstreamResourceTypes,
  LOGSTREAM_STRATEGY_ID,
  LOGSTREAM_ACTIVITY,
  LOGSTREAM_IMPORTANT_EVENT,
} from "@checkstack/logstream-common";
import { buildLogstreamOptionsResolvers } from "./health-options-resolvers";
import { CorrelatedLogs } from "./components/CorrelatedLogs";

/**
 * Log stream frontend plugin. Phase-1 skeleton: the two routes and the
 * "Reliability" nav entry are wired with the correct access gating and
 * `manageCapability`, so team-scoped stream managers see the surface. The
 * Frontend agent fills the page bodies (plan §9).
 */
export default createFrontendPlugin({
  metadata: pluginMetadata,
  // Register the stream-scoped signals so the auto-invalidator narrows
  // invalidation to the ingesting stream (via each signal's `resourceKey`)
  // instead of refetching every open logstream query on any stream's activity.
  // The list page opts its resource-agnostic summaries back into whole-plugin
  // refresh with `meta: { signalScope: "plugin" }`.
  signals: [LOGSTREAM_ACTIVITY, LOGSTREAM_IMPORTANT_EVENT],
  // Contribute the stream / pattern dropdown resolvers for the `logstream`
  // health-check strategy's config fields. The editor reads the metadata; the
  // component is never rendered (metadata-only contribution).
  extensions: [
    createSlotExtension(HealthCheckConfigOptionsResolverSlot, {
      id: "logstream.health-config-options-resolvers",
      component: () => null,
      metadata: {
        strategyId: LOGSTREAM_STRATEGY_ID,
        buildResolvers: buildLogstreamOptionsResolvers,
      },
    }),
    // Contribute the "correlated logs" panel to the trace detail view: the log
    // lines sharing the open trace's id, grouped per stream. Self-hides when the
    // trace has no correlated logs.
    createSlotExtension(TraceCorrelationsSlot, {
      id: "logstream.trace-correlations",
      component: ({ traceId, startTs, endTs }) => (
        <CorrelatedLogs traceId={traceId} startTs={startTs} endTs={endTs} />
      ),
    }),
    // Compact "Logs" card on the catalog system detail page: the streams linked
    // to the system. Lazy - only loads when a system-detail page renders.
    createSlotExtension(SystemDetailsSlot, {
      id: "logstream.system-details.logs",
      load: () =>
        import("./components/LogsSystemCard").then((m) => ({
          default: m.LogsSystemCard,
        })),
    }),
    // Headless dashboard signals filler: linked streams' error spikes. Lazy -
    // only loads when the dashboard overview mounts the slot.
    createSlotExtension(SystemSignalsSlot, {
      id: "logstream.dashboard.signals",
      load: () =>
        import("./components/LogSignalsFiller").then((m) => ({
          default: m.LogSignalsFiller,
        })),
    }),
  ],
  routes: [
    {
      route: logstreamRoutes.routes.home,
      load: () =>
        import("./pages/LogStreamListPage").then((m) => ({
          default: m.LogStreamListPage,
        })),
      title: "Log Streams",
      // The list is a READ surface (create/tokens/settings are gated per-action
      // inside the pages via useGatedMutation). Streams are team-scopable, so a
      // team read grant (no global rule) must reveal the route: manageCapability
      // admits grant-holders of `logstream.stream` even though the gate is read.
      // The objectType MUST be the team-scopable type - the CI guard checks it.
      accessRule: logstreamAccess.read,
      manageCapability: {
        objectType: logstreamResourceTypes.stream,
      },
      nav: {
        group: "Reliability",
        icon: ScrollText,
        accessRule: logstreamAccess.read,
      },
    },
    {
      route: logstreamRoutes.routes.detail,
      load: () =>
        import("./pages/LogStreamDetailPage").then((m) => ({
          default: m.LogStreamDetailPage,
        })),
      title: "Log Stream",
      accessRule: logstreamAccess.read,
      manageCapability: {
        objectType: logstreamResourceTypes.stream,
      },
    },
  ],
});

export * from "./api";
