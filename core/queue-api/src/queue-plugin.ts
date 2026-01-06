import { z } from "zod";
import type { Queue } from "./queue";
import type { Migration } from "@checkmate-monitor/backend-api";

export interface QueuePlugin<Config = unknown> {
  id: string;
  displayName: string;
  description?: string;

  /** Current version of the configuration schema */
  configVersion: number;

  /** Validation schema for the plugin-specific config */
  configSchema: z.ZodType<Config>;

  /** Optional migrations for backward compatibility */
  migrations?: Migration<unknown, unknown>[];

  createQueue<T>(name: string, config: Config): Queue<T>;
}

export interface QueuePluginRegistry {
  register(plugin: QueuePlugin<unknown>): void;
  getPlugin(id: string): QueuePlugin<unknown> | undefined;
  getPlugins(): QueuePlugin<unknown>[];
}

/**
 * Result of switching queue backends
 */
export interface SwitchResult {
  success: boolean;
  migratedRecurringJobs: number;
  warnings: string[];
}

/**
 * Info about a recurring job across all queues
 */
export interface RecurringJobInfo {
  queueName: string;
  jobId: string;
  intervalSeconds: number;
  nextRunAt?: Date;
}

/**
 * QueueManager handles queue creation, backend switching, and multi-instance coordination.
 *
 * Key features:
 * - Returns stable QueueProxy instances that survive backend switches
 * - Polls config for changes to support multi-instance coordination
 * - Handles graceful migration of recurring jobs when switching backends
 */
export interface QueueManager {
  /**
   * Get or create a queue proxy.
   * Returns a stable reference that survives backend switches.
   * Subscriptions are automatically re-applied when backend changes.
   */
  getQueue<T>(name: string): Queue<T>;

  /**
   * Get the currently active queue plugin ID
   */
  getActivePlugin(): string;

  /**
   * Get the currently active queue plugin configuration
   */
  getActiveConfig(): unknown;

  /**
   * Switch to a different queue backend with job migration.
   *
   * @throws Error if connection test fails
   * @throws Error if migration fails
   */
  setActiveBackend(pluginId: string, config: unknown): Promise<SwitchResult>;

  /**
   * Get total number of in-flight jobs across all queues.
   * Used to warn users before switching backends.
   */
  getInFlightJobCount(): Promise<number>;

  /**
   * List all recurring jobs across all queues.
   * Used for migration preview.
   */
  listAllRecurringJobs(): Promise<RecurringJobInfo[]>;

  /**
   * Start polling for configuration changes.
   * Required for multi-instance coordination.
   * @param intervalMs - Polling interval in milliseconds (default: 5000)
   */
  startPolling(intervalMs?: number): void;

  /**
   * Stop polling and gracefully shutdown all queues.
   */
  shutdown(): Promise<void>;
}
