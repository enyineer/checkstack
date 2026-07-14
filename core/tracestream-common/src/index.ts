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

// Browser-safe trace ingest parsing (OTLP protobuf/JSON + native JSON) + clamp
export * from "./ingest";

// Realtime signals
export * from "./signals";

// Frontend slots (fillable by other plugins)
export * from "./slots";

// RPC contract + client definition
export {
  tracestreamContract,
  TracestreamApi,
  type TracestreamContract,
} from "./rpc-contract";
