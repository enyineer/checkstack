// Re-export the client definition + commonly used types for convenience.
// Frontend usage: `const client = usePluginClient(TelemetryApi);`
export { TelemetryApi } from "@checkstack/telemetry-common";
export type {
  TelemetrySource,
  CreateTelemetrySource,
  UpdateTelemetrySource,
  SourceTypeDescriptor,
  SourceBinding,
  SourceMode,
  WebhookInfo,
  TestSourceConfig,
  TestSourceConfigResult,
  TelemetrySignal,
} from "@checkstack/telemetry-common";
