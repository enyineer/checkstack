import { createFrontendPlugin, createSlotExtension } from "@checkstack/frontend-api";
import { Cable } from "lucide-react";
import {
  pluginMetadata,
  telemetryAccess,
  telemetryResourceTypes,
  telemetryRoutes,
  SourceConfigSlot,
  LOG_TO_METRIC_SOURCE_TYPE_ID,
  LOG_TO_TRACE_SOURCE_TYPE_ID,
  TELEMETRY_SOURCE_CHANGED,
} from "@checkstack/telemetry-common";

/**
 * Telemetry platform frontend plugin. It exposes the global "Sources" page (all
 * source instances the caller may read, across every stream and signal) under
 * the Reliability nav group, alongside the in-context `StreamSourcesSection`
 * embed that owning stream plugins (logstream, metricstream, ...) mount on their
 * detail pages.
 *
 * The Sources route is a READ surface: create/edit/rotate/delete are gated
 * per-action inside the page via `useProcedureAccess` / `useResourceAccess` /
 * `useGatedMutation`. Sources are team-scopable, so `manageCapability` admits a
 * team grant-holder of `telemetry.source` even though the route gate is read -
 * the objectType MUST be that team-scopable type (the CI guard checks it).
 *
 * `signals` registers the source-changed signal so its `resourceKey` scopes
 * cache invalidation to the changed instance; list queries opt back into
 * whole-plugin refresh with `meta: { signalScope: "plugin" }`.
 */
export default createFrontendPlugin({
  metadata: pluginMetadata,
  signals: [TELEMETRY_SOURCE_CHANGED],
  routes: [
    {
      route: telemetryRoutes.routes.sources,
      load: () =>
        import("./pages/SourcesPage").then((m) => ({
          default: m.SourcesPage,
        })),
      title: "Sources",
      accessRule: telemetryAccess.read,
      manageCapability: {
        objectType: telemetryResourceTypes.source,
      },
      nav: {
        group: "Reliability",
        icon: Cable,
        accessRule: telemetryAccess.read,
      },
    },
  ],
  // Bespoke config editors for the platform's built-in DERIVE source types. Each
  // filler matches the generic source dialog's config section by the type's
  // qualified id (single-sourced in telemetry-common), giving the derive types a
  // real input-stream picker instead of the schema-driven DynamicForm.
  extensions: [
    createSlotExtension(SourceConfigSlot, {
      id: "telemetry.log-to-metric-config",
      metadata: { sourceTypeId: LOG_TO_METRIC_SOURCE_TYPE_ID },
      load: () =>
        import("./components/derive/LogToMetricConfig").then((m) => ({
          default: m.LogToMetricConfig,
        })),
    }),
    createSlotExtension(SourceConfigSlot, {
      id: "telemetry.log-to-trace-config",
      metadata: { sourceTypeId: LOG_TO_TRACE_SOURCE_TYPE_ID },
      load: () =>
        import("./components/derive/LogToTraceConfig").then((m) => ({
          default: m.LogToTraceConfig,
        })),
    }),
  ],
});

// The embed and its supporting types are the plugin's public surface: owning
// stream plugins import `StreamSourcesSection` from this package entry.
export { StreamSourcesSection } from "./components/StreamSourcesSection";
export type { StreamSourcesSectionProps } from "./components/StreamSourcesSection";
// The dashboard signal filler engine every stream plugin's headless
// `SystemSignalsSlot` filler is built on.
export { useLinkedStreamSignals } from "./hooks/useLinkedStreamSignals";
export type { UseLinkedStreamSignalsOptions } from "./hooks/useLinkedStreamSignals";
export * from "./api";
