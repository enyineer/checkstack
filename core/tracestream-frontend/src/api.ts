// Re-export types from common for convenience
export type {
  TraceStream,
  TraceSummary,
  TraceSpan,
  TraceStreamConfig,
} from "@checkstack/tracestream-common";

// Re-export the Api definition for usePluginClient usage
export { TracestreamApi } from "@checkstack/tracestream-common";
