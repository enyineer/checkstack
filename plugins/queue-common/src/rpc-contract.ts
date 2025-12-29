import { oc } from "@orpc/contract";
import { z } from "zod";
import { permissions } from "./permissions";
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

// Export contract type for frontend
export type QueueContract = typeof queueContract;
