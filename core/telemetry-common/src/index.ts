// Access rules + resource types
export {
  telemetryAccess,
  telemetryAccessRules,
  telemetryResourceTypes,
} from "./access";

// Plugin metadata
export * from "./plugin-metadata";

// Routes
export { telemetryRoutes } from "./routes";

// Signal model (logs/metrics/traces) + normalized records
export * from "./signal-model";
export * from "./records";

// Source instance / source type schemas
export * from "./schemas";

// Realtime signals
export * from "./signals";

// Satellite pull-capability wire contracts (shared by the core handler and the
// satellite-side scheduler; browser-safe pure zod + converters)
export * from "./satellite/pull-capability";

// Frontend slots
export * from "./slots";

// Built-in derive source type ids (shared by the platform backend registration
// and the frontend config-slot fillers)
export * from "./derive-types";

// Shared schemas for explicit stream -> catalog-system links
export * from "./system-links";

// RPC contract + client definition
export {
  telemetryContract,
  TelemetryApi,
  type TelemetryContract,
} from "./rpc-contract";
