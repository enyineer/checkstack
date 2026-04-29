import { QueuePlugin, Queue } from "@checkstack/queue-api";
import type { Logger } from "@checkstack/backend-api";
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
  /**
   * Multiplier for all delays (retry backoff, startDelay).
   * Default is 1 (normal). Set to 0.01 in tests for 100x faster delays.
   */
  delayMultiplier: z
    .number()
    .min(0)
    .max(1)
    .default(1)
    .describe(
      "Delay multiplier (default: 1). Only change for testing purposes - set to 0.01 for 100x faster test execution.",
    ),
  /**
   * Interval in milliseconds for the heartbeat that checks for ready jobs.
   * This ensures jobs are processed even if setTimeout fails (e.g., after system sleep).
   * Set to 0 to disable.
   */
  heartbeatIntervalMs: z
    .number()
    .min(0)
    .default(5000)
    .describe(
      "Heartbeat interval in ms to check for ready jobs (default: 5000). Set to 0 to disable.",
    ),
});

export type InMemoryQueueConfig = z.infer<typeof configSchema>;

export class InMemoryQueuePlugin implements QueuePlugin<InMemoryQueueConfig> {
  id = "memory";
  displayName = "In-Memory Queue";
  description =
    "Simple in-memory queue for development and single-instance deployments";
  configVersion = 1; // Initial version
  configSchema = configSchema;

  createQueue<T>(
    name: string,
    config: InMemoryQueueConfig,
    logger: Logger,
  ): Queue<T> {
    return new InMemoryQueue<T>(name, config, logger);
  }
}
