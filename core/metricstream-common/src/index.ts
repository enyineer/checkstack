// Access rules + resource types
export {
  metricstreamAccess,
  metricstreamAccessRules,
  metricstreamResourceTypes,
} from "./access";

// Routes
export { metricstreamRoutes } from "./routes";

// Plugin metadata
export * from "./plugin-metadata";

// Source token FORMAT helpers (browser-safe; ckms_ prefix)
export * from "./token";

// Schemas and inferred types
export * from "./schemas";

// Realtime signals
export * from "./signals";

// Health-check dropdown resolver names (shared by backend annotations + frontend)
export * from "./health-resolvers";

// RPC contract + client definition
export {
  metricstreamContract,
  MetricstreamApi,
  type MetricstreamContract,
} from "./rpc-contract";

// Satellite capability wire contracts (shared by the core handlers and the
// satellite-side scraper/forwarder; browser-safe - see the guard test).
export * from "./satellite/scrape-capability";

// Pure ingest parsing / normalization (shared by the backend ingest area and
// the satellite-side telemetry agent; browser-safe - see the guard test).
export * from "./ingest/clamp";
export * from "./sources/prometheus/text-parse";
export * from "./sources/prometheus/scrape-shaping";
export * from "./sources/otlp/decode";
export * from "./sources/otlp/normalize";
export * from "./sources/otlp/json";
export * from "./sources/native/parse";
