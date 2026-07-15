// Re-export the client definition + commonly used types for convenience.
// Frontend usage: `const client = usePluginClient(MetricstreamApi);`
export { MetricstreamApi } from "@checkstack/metricstream-common";
export type {
  MetricStream,
  CreateMetricStream,
  UpdateMetricStream,
  MetricNameInfo,
  MetricSeriesInfo,
  ImportantEvent,
  StreamOverview,
} from "@checkstack/metricstream-common";
