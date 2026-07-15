// Access rules + resource types
export {
  logstreamAccess,
  logstreamAccessRules,
  logstreamResourceTypes,
} from "./access";

// Routes
export { logstreamRoutes } from "./routes";

// Plugin metadata
export * from "./plugin-metadata";

// Severity banding helpers
export * from "./severity";

// Backtracking-safety analysis for user-authored ingest regexes
export * from "./regex-safety";

// Source token helpers
export * from "./token";

// Schemas and inferred types
export * from "./schemas";

// Dashboard signal event-type set (shared by the backend status query + the
// frontend signals deriver so they cannot drift).
export * from "./signal-event-types";

// Realtime signals
export * from "./signals";

// Frontend slots (fillable by other plugins)
export * from "./slots";

// Health-check dropdown resolver names (shared by backend annotations + frontend)
export * from "./health-resolvers";

// RPC contract + client definition
export {
  logstreamContract,
  LogstreamApi,
  type LogstreamContract,
} from "./rpc-contract";

// Pure ingest parsing / normalization (shared by the backend ingest area and
// the satellite-side telemetry agent; browser-safe - see the guard test).
export * from "./ingest/normalize";
export * from "./ingest/protobuf/otlp";
export * from "./ingest/protobuf/otlp-encode";
export * from "./ingest/parse/otlp";
export * from "./ingest/parse/native";
export * from "./ingest/parse/syslog";
export * from "./ingest/syslog/framing";
export * from "./ingest/satellite-relay";
