import { createClientDefinition, proc } from "@checkstack/common";
import { z } from "zod";
import { queueAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  QueuePluginDtoSchema,
  QueueConfigurationDtoSchema,
  UpdateQueueConfigurationSchema,
  QueueStatsDtoSchema,
  QueueLagStatusSchema,
  QueueLagThresholdsSchema,
} from "./schemas";

// Queue RPC Contract with access metadata
export const queueContract = {
  // Queue plugin queries - Read access
  getPlugins: proc({
    operationType: "query",
    userType: "authenticated",
    access: [queueAccess.settings.read],
  }).output(z.array(QueuePluginDtoSchema)),

  getConfiguration: proc({
    operationType: "query",
    userType: "authenticated",
    access: [queueAccess.settings.read],
  }).output(QueueConfigurationDtoSchema),

  // Queue configuration updates - Manage access
  updateConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [queueAccess.settings.manage],
  })
    .input(UpdateQueueConfigurationSchema)
    .output(QueueConfigurationDtoSchema),

  // Queue statistics - Read access
  getStats: proc({
    operationType: "query",
    userType: "authenticated",
    access: [queueAccess.settings.read],
  }).output(QueueStatsDtoSchema),

  // Queue lag status (includes thresholds) - Read access
  getLagStatus: proc({
    operationType: "query",
    userType: "authenticated",
    access: [queueAccess.settings.read],
  }).output(QueueLagStatusSchema),

  // Update lag thresholds - Manage access
  updateLagThresholds: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [queueAccess.settings.manage],
  })
    .input(QueueLagThresholdsSchema)
    .output(QueueLagThresholdsSchema),
};

// Export contract type
export type QueueContract = typeof queueContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(QueueApi);
export const QueueApi = createClientDefinition(queueContract, pluginMetadata);
