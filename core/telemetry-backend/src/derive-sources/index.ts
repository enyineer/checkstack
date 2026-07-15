/**
 * Registration of the telemetry platform's OWN built-in derive source types.
 *
 * These are platform-generic (they consume only normalized records, never a
 * stream plugin's internals), so the telemetry backend contributes them to its
 * own source registry - exactly as any other plugin would through the source
 * extension point, but from inside the platform. `register()` calls this via the
 * source extension point so the built-ins share the one registration path and
 * boot-time validation (see `createTelemetrySourceRegistry`).
 */

import type { PluginMetadata } from "@checkstack/common";
import type { TelemetrySourceExtensionPoint } from "../extension-points";
import { createLogToMetricSourceType } from "./log-to-metric";
import { createLogToTraceSourceType } from "./log-to-trace";

/**
 * Register every built-in derive source type against the given source extension
 * point (the telemetry platform's own registry, contributed under the telemetry
 * plugin metadata so they qualify as `telemetry.log-to-metric` / `.log-to-trace`).
 */
export function registerBuiltinDeriveSourceTypes({
  point,
  pluginMetadata,
}: {
  point: TelemetrySourceExtensionPoint;
  pluginMetadata: PluginMetadata;
}): void {
  point.registerSourceType(createLogToMetricSourceType(), pluginMetadata);
  point.registerSourceType(createLogToTraceSourceType(), pluginMetadata);
}

export {
  createLogToMetricSourceType,
  foldLogsToMetric,
  LogToMetricConfigSchema,
  type LogToMetricConfig,
} from "./log-to-metric";
export {
  createLogToTraceSourceType,
  foldLogsToTrace,
  LogToTraceConfigSchema,
  SERVICE_NAME_FROM_RESOURCE,
  type LogToTraceConfig,
  type LogToTraceFoldResult,
} from "./log-to-trace";
