// Re-export the client definition + commonly used types for convenience.
// Frontend usage: `const client = usePluginClient(LogstreamApi);`
export { LogstreamApi } from "@checkstack/logstream-common";
export type {
  LogStream,
  CreateLogStream,
  UpdateLogStream,
  LogStreamToken,
  LogEvent,
  LogPattern,
  ImportantEvent,
  SeverityBand,
} from "@checkstack/logstream-common";
