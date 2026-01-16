// Re-export types for convenience
export type {
  QueuePluginDto,
  QueueConfigurationDto,
  UpdateQueueConfiguration,
} from "@checkstack/queue-common";
// Client definition is in @checkstack/queue-common - use with usePluginClient
export { QueueApi } from "@checkstack/queue-common";
