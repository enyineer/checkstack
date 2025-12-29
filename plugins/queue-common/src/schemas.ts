import { z } from "zod";

/**
 * DTO for queue plugin information
 */
export const QueuePluginDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  configVersion: z.number(),
  configSchema: z.record(z.string(), z.unknown()),
});

export type QueuePluginDto = z.infer<typeof QueuePluginDtoSchema>;

/**
 * DTO for current queue configuration
 */
export const QueueConfigurationDtoSchema = z.object({
  pluginId: z.string(),
  config: z.record(z.string(), z.unknown()),
});

export type QueueConfigurationDto = z.infer<typeof QueueConfigurationDtoSchema>;

/**
 * Schema for updating queue configuration
 */
export const UpdateQueueConfigurationSchema = z.object({
  pluginId: z.string().describe("ID of the queue plugin to use"),
  config: z
    .record(z.string(), z.unknown())
    .describe("Plugin-specific configuration"),
});

export type UpdateQueueConfiguration = z.infer<
  typeof UpdateQueueConfigurationSchema
>;
