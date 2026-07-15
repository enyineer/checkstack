// Access rules + resource types
export {
  tracestreamAccess,
  tracestreamAccessRules,
  tracestreamResourceTypes,
} from "./access";

// Routes
export { tracestreamRoutes } from "./routes";

// Plugin metadata
export * from "./plugin-metadata";

// Source token FORMAT helpers (browser-safe; cktr_ prefix)
export * from "./token";

// Schemas and inferred types
export * from "./schemas";

// Dashboard signal event-type set (shared by the backend status query + the
// frontend signals deriver so they cannot drift).
export * from "./signal-event-types";

// Browser-safe trace ingest parsing (OTLP protobuf/JSON + native JSON) + clamp
export * from "./ingest";

// Realtime signals
export * from "./signals";

// Frontend slots (fillable by other plugins)
export * from "./slots";

// Health-check integration identifiers (strategy id + dropdown resolvers)
export * from "./health-resolvers";

// RPC contract + client definition
export {
  tracestreamContract,
  TracestreamApi,
  type TracestreamContract,
} from "./rpc-contract";
