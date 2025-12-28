import { QueuePlugin, Queue } from "@checkmate/queue-api";
import { z } from "zod";
import { InMemoryQueue } from "./memory-queue";

const configSchema = z.object({
  concurrency: z
    .number()
    .min(1)
    .max(100)
    .default(10)
    .describe("Maximum number of concurrent jobs to process"),
  maxQueueSize: z
    .number()
    .min(1)
    .default(10_000)
    .describe("Maximum number of jobs that can be queued"),
});

export type InMemoryQueueConfig = z.infer<typeof configSchema>;

export class InMemoryQueuePlugin implements QueuePlugin<InMemoryQueueConfig> {
  id = "memory";
  displayName = "In-Memory Queue";
  description =
    "Simple in-memory queue for development and single-instance deployments";
  configSchema = configSchema;

  createQueue<T>(name: string, config: InMemoryQueueConfig): Queue<T> {
    return new InMemoryQueue<T>(name, config);
  }
}
