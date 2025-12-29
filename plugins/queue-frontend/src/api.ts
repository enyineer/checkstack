import { createApiRef } from "@checkmate/frontend-api";
import type { ContractRouterClient } from "@orpc/contract";
import { queueContract } from "@checkmate/queue-common";

// Re-export types for convenience
export type {
  QueuePluginDto,
  QueueConfigurationDto,
  UpdateQueueConfiguration,
} from "@checkmate/queue-common";

// QueueApi is the client type derived from the contract
export type QueueApi = ContractRouterClient<typeof queueContract>;

export const queueApiRef = createApiRef<QueueApi>("queue-api");
