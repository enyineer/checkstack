import { createApiRef } from "@checkmate-monitor/frontend-api";
import { QueueApi } from "@checkmate-monitor/queue-common";
import type { InferClient } from "@checkmate-monitor/common";

// Re-export types for convenience
export type {
  QueuePluginDto,
  QueueConfigurationDto,
  UpdateQueueConfiguration,
} from "@checkmate-monitor/queue-common";

// QueueApiClient type inferred from the client definition
export type QueueApiClient = InferClient<typeof QueueApi>;

export const queueApiRef = createApiRef<QueueApiClient>("queue-api");
