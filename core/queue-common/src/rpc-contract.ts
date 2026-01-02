import { oc } from "@orpc/contract";
import { createClientDefinition } from "@checkmate/common";
import { z } from "zod";
import { permissions } from "./permissions";
import { pluginMetadata } from "./plugin-metadata";
import {
  QueuePluginDtoSchema,
  QueueConfigurationDtoSchema,
  UpdateQueueConfigurationSchema,
} from "./schemas";

// Permission metadata type
export interface QueueMetadata {
  permissions?: string[];
}

// Base builder with metadata support
const _base = oc.$meta<QueueMetadata>({});

// Queue RPC Contract with permission metadata
export const queueContract = {
  // Queue plugin queries - Read permission
  getPlugins: _base
    .meta({ permissions: [permissions.queueRead.id] })
    .output(z.array(QueuePluginDtoSchema)),

  getConfiguration: _base
    .meta({ permissions: [permissions.queueRead.id] })
    .output(QueueConfigurationDtoSchema),

  // Queue configuration updates - Manage permission
  updateConfiguration: _base
    .meta({ permissions: [permissions.queueManage.id] })
    .input(UpdateQueueConfigurationSchema)
    .output(QueueConfigurationDtoSchema),
};

// Export contract type
export type QueueContract = typeof queueContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(QueueApi);
export const QueueApi = createClientDefinition(queueContract, pluginMetadata);
