import { oc } from "@orpc/contract";
import {
  createClientDefinition,
  type ProcedureMetadata,
} from "@checkstack/common";
import { z } from "zod";
import { queueAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  QueuePluginDtoSchema,
  QueueConfigurationDtoSchema,
  UpdateQueueConfigurationSchema,
} from "./schemas";

// Base builder with metadata support
const _base = oc.$meta<ProcedureMetadata>({});

// Queue RPC Contract with access metadata
export const queueContract = {
  // Queue plugin queries - Read access
  getPlugins: _base
    .meta({
      userType: "authenticated",
      access: [queueAccess.settings.read],
    })
    .output(z.array(QueuePluginDtoSchema)),

  getConfiguration: _base
    .meta({
      userType: "authenticated",
      access: [queueAccess.settings.read],
    })
    .output(QueueConfigurationDtoSchema),

  // Queue configuration updates - Manage access
  updateConfiguration: _base
    .meta({
      userType: "authenticated",
      access: [queueAccess.settings.manage],
    })
    .input(UpdateQueueConfigurationSchema)
    .output(QueueConfigurationDtoSchema),
};

// Export contract type
export type QueueContract = typeof queueContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(QueueApi);
export const QueueApi = createClientDefinition(queueContract, pluginMetadata);
