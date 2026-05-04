import type {
  Queue,
  QueueManager,
  SwitchResult,
  RecurringJobInfo,
  QueueStats,
  JobSummary,
  ListJobsOptions,
  ListJobsResult,
} from "@checkstack/queue-api";
import type { QueuePluginRegistryImpl } from "./queue-plugin-registry";
import type { Logger, ConfigService } from "@checkstack/backend-api";
import { z } from "zod";
import { QueueProxy } from "./queue-proxy";
import { extractErrorMessage } from "@checkstack/common";

// Schema for active plugin pointer with version for multi-instance coordination
const activePluginPointerSchema = z.object({
  activePluginId: z.string(),
  version: z.number(),
});

type ActivePluginPointer = z.infer<typeof activePluginPointerSchema>;

/**
 * QueueManagerImpl handles queue creation, backend switching, and multi-instance coordination.
 *
 * Features:
 * - Returns stable QueueProxy instances that survive backend switches
 * - Polls config for changes to support multi-instance coordination
 * - Handles graceful migration of recurring jobs when switching backends
 */
export class QueueManagerImpl implements QueueManager {
  private activePluginId: string = "memory"; // Default
  private activeConfig: unknown = { concurrency: 10, maxQueueSize: 10_000 };
  private configVersion: number = 0;

  // Stable queue proxies - survive backend switches
  private queueProxies = new Map<string, QueueProxy<unknown>>();

  // Polling
  private pollingInterval: ReturnType<typeof setInterval> | undefined =
    undefined;

  constructor(
    private registry: QueuePluginRegistryImpl,
    private configService: ConfigService,
    private logger: Logger,
  ) {}

  async loadConfiguration(): Promise<void> {
    try {
      // Load active plugin pointer
      const pointer = await this.configService.get<ActivePluginPointer>(
        "queue:active",
        activePluginPointerSchema,
        1,
      );

      if (pointer) {
        this.activePluginId = pointer.activePluginId;
        this.configVersion = pointer.version;

        // Load the actual config for this plugin
        const plugin = this.registry.getPlugin(this.activePluginId);
        if (plugin) {
          const config = await this.configService.get(
            this.activePluginId,
            plugin.configSchema,
            plugin.configVersion,
          );

          if (config) {
            this.activeConfig = config;
          }
        }

        this.logger.info(
          `📋 Loaded queue configuration: plugin=${this.activePluginId}, version=${this.configVersion}`,
        );
      } else {
        this.logger.info(
          `📋 No queue configuration found, using default: plugin=${this.activePluginId}`,
        );
      }
    } catch (error) {
      this.logger.error("Failed to load queue configuration", error);
      // Continue with defaults
    }
  }

  getQueue<T>(name: string): Queue<T> {
    let proxy = this.queueProxies.get(name) as QueueProxy<T> | undefined;

    if (!proxy) {
      proxy = new QueueProxy<T>(name);
      this.queueProxies.set(name, proxy as QueueProxy<unknown>);

      // If we already have config loaded, create delegate immediately
      if (this.configVersion > 0 || this.activePluginId === "memory") {
        this.initializeQueueProxy(proxy, name);
      }
    }

    return proxy;
  }

  private initializeQueueProxy<T>(proxy: QueueProxy<T>, name: string): void {
    const plugin = this.registry.getPlugin(this.activePluginId);
    if (!plugin) {
      this.logger.warn(
        `Queue plugin '${this.activePluginId}' not found, deferring queue creation`,
      );
      return;
    }

    const queue = plugin.createQueue<T>(name, this.activeConfig, this.logger);
    proxy.switchDelegate(queue).catch((error) => {
      this.logger.error(`Failed to initialize queue '${name}'`, error);
    });
  }

  getActivePlugin(): string {
    return this.activePluginId;
  }

  getActiveConfig(): unknown {
    return this.activeConfig;
  }

  async setActiveBackend(
    pluginId: string,
    config: unknown,
  ): Promise<SwitchResult> {
    const warnings: string[] = [];

    // 1. Validate plugin exists
    const newPlugin = this.registry.getPlugin(pluginId);
    if (!newPlugin) {
      throw new Error(`Plugin '${pluginId}' not found`);
    }

    // 2. Validate config against schema
    newPlugin.configSchema.parse(config);

    // 3. Test connection
    this.logger.info("🔍 Testing queue connection...");
    try {
      const testQueue = newPlugin.createQueue(
        "__connection_test__",
        config,
        this.logger,
      );
      await testQueue.testConnection();
      await testQueue.stop();
      this.logger.info("✅ Connection test successful");
    } catch (error) {
      const message = extractErrorMessage(error);
      this.logger.error(`❌ Connection test failed: ${message}`);
      throw new Error(`Failed to connect to queue: ${message}`);
    }

    // 4. Check for in-flight jobs and warn
    const inFlightCount = await this.getInFlightJobCount();
    if (inFlightCount > 0) {
      warnings.push(
        `${inFlightCount} jobs are currently in-flight and may be disrupted`,
      );
      this.logger.warn(
        `⚠️ ${inFlightCount} in-flight jobs detected during backend switch`,
      );
    }

    // 5. Collect recurring jobs for migration
    const oldPlugin = this.registry.getPlugin(this.activePluginId);
    const recurringJobs = await this.listAllRecurringJobs();
    let migratedRecurringJobs = 0;

    // 6. Stop all current queues gracefully
    this.logger.info("🛑 Stopping current queues...");
    for (const [name, proxy] of this.queueProxies.entries()) {
      this.logger.debug(`Stopping queue: ${name}`);
      await proxy.stop().catch((error) => {
        this.logger.error(`Failed to stop queue ${name}`, error);
      });
    }

    // 7. Update internal state
    const oldPluginId = this.activePluginId;
    this.activePluginId = pluginId;
    this.activeConfig = config;
    this.configVersion++;

    // 8. Create new queues and switch delegates
    this.logger.info("🔄 Switching to new backend...");
    for (const [name, proxy] of this.queueProxies.entries()) {
      const newQueue = newPlugin.createQueue(name, config, this.logger);
      await proxy.switchDelegate(newQueue);
    }

    // 9. Migrate recurring jobs
    if (recurringJobs.length > 0 && oldPlugin && pluginId !== oldPluginId) {
      this.logger.info(
        `📦 Migrating ${recurringJobs.length} recurring jobs...`,
      );

      for (const job of recurringJobs) {
        try {
          // Get the proxy for this queue
          const proxy = this.queueProxies.get(job.queueName);
          if (proxy) {
            // Get details from old implementation (via proxy's old delegate before switch)
            // Since we already switched, we need to get this from the collected info
            const details = await proxy.getRecurringJobDetails(job.jobId);
            if (details) {
              // Use if/else to properly satisfy XOR type constraint
              // eslint-disable-next-line unicorn/prefer-ternary
              if ("cronPattern" in details && details.cronPattern) {
                await proxy.scheduleRecurring(details.data as unknown, {
                  jobId: details.jobId,
                  priority: details.priority,
                  cronPattern: details.cronPattern,
                });
              } else {
                await proxy.scheduleRecurring(details.data as unknown, {
                  jobId: details.jobId,
                  priority: details.priority,
                  intervalSeconds: details.intervalSeconds!,
                });
              }
              migratedRecurringJobs++;
            }
          }
        } catch (error) {
          this.logger.error(
            `Failed to migrate recurring job ${job.jobId}`,
            error,
          );
          warnings.push(`Failed to migrate recurring job: ${job.jobId}`);
        }
      }
    }

    // 10. Save configuration
    await this.configService.set(
      pluginId,
      newPlugin.configSchema,
      newPlugin.configVersion,
      config,
    );

    await this.configService.set("queue:active", activePluginPointerSchema, 1, {
      activePluginId: pluginId,
      version: this.configVersion,
    });

    this.logger.info(`✅ Queue backend switched: ${oldPluginId} → ${pluginId}`);

    return {
      success: true,
      migratedRecurringJobs,
      warnings,
    };
  }

  async getInFlightJobCount(): Promise<number> {
    let total = 0;
    for (const proxy of this.queueProxies.values()) {
      try {
        const delegate = proxy.getDelegate();
        if (delegate) {
          total += await delegate.getInFlightCount();
        }
      } catch {
        // Queue may not be initialized yet
      }
    }
    return total;
  }

  async getAggregatedStats(): Promise<QueueStats> {
    // The narrowest scope wins: if any queue reports `instance`, the
    // aggregate cannot claim cluster-wide accuracy.
    let scope: "instance" | "cluster" = "cluster";
    let sawAny = false;
    const aggregated: Omit<QueueStats, "scope"> = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      consumerGroups: 0,
    };

    for (const proxy of this.queueProxies.values()) {
      try {
        const delegate = proxy.getDelegate();
        if (delegate) {
          const stats = await delegate.getStats();
          aggregated.pending += stats.pending;
          aggregated.processing += stats.processing;
          aggregated.completed += stats.completed;
          aggregated.failed += stats.failed;
          aggregated.consumerGroups += stats.consumerGroups;
          if (stats.scope === "instance") {
            scope = "instance";
          }
          sawAny = true;
        }
      } catch {
        // Queue may not be initialized yet
      }
    }

    return { ...aggregated, scope: sawAny ? scope : "instance" };
  }

  /**
   * Aggregate `listJobs` across every queue proxy. For deployments with a
   * single queue (the common case) this is a straight pass-through; with
   * multiple queues we over-fetch [0, offset+limit) per queue, merge-sort
   * by the same key the per-queue impls use, then slice the requested
   * window. Sort key:
   *  - completed/failed → finishedAt desc (most-recent first)
   *  - active           → startedAt asc (oldest still-running first)
   *  - waiting/delayed  → enqueuedAt asc (FIFO)
   */
  async listJobs(opts: ListJobsOptions): Promise<ListJobsResult> {
    const limit = Math.max(0, opts.limit);
    const offset = Math.max(0, opts.offset);
    if (limit === 0) {
      return { items: [], total: 0, hasMore: false };
    }

    const fetchUpTo = offset + limit;
    const merged: JobSummary[] = [];
    let totalSum = 0;
    let totalIsNull = false;

    for (const proxy of this.queueProxies.values()) {
      try {
        const delegate = proxy.getDelegate();
        if (delegate) {
          const part = await delegate.listJobs({
            state: opts.state,
            offset: 0,
            limit: fetchUpTo,
          });
          merged.push(...part.items);
          if (part.total === null) {
            totalIsNull = true;
          } else {
            totalSum += part.total;
          }
        }
      } catch {
        // Queue may not be initialized yet
      }
    }

    const sortKey = (j: JobSummary): number => {
      if (opts.state === "completed" || opts.state === "failed") {
        return -(j.finishedAt?.getTime() ?? 0);
      }
      if (opts.state === "active") {
        return j.startedAt?.getTime() ?? 0;
      }
      return j.enqueuedAt.getTime();
    };
    merged.sort((a, b) => sortKey(a) - sortKey(b));

    const items = merged.slice(offset, offset + limit);
    const total = totalIsNull ? null : totalSum;
    const hasMore =
      total === null
        ? merged.length > offset + items.length
        : offset + items.length < total;

    return { items, total, hasMore };
  }

  async listAllRecurringJobs(): Promise<RecurringJobInfo[]> {
    const jobs: RecurringJobInfo[] = [];

    for (const [queueName, proxy] of this.queueProxies.entries()) {
      try {
        const delegate = proxy.getDelegate();
        if (delegate) {
          const jobIds = await delegate.listRecurringJobs();
          for (const jobId of jobIds) {
            const details = await delegate.getRecurringJobDetails(jobId);
            if (details) {
              // Extract schedule from details (XOR pattern - one must be defined)
              const schedule =
                "cronPattern" in details
                  ? { cronPattern: details.cronPattern }
                  : { intervalSeconds: details.intervalSeconds };

              jobs.push({
                queueName,
                jobId,
                nextRunAt: details.nextRunAt,
                ...schedule,
              } as RecurringJobInfo);
            }
          }
        }
      } catch {
        // Queue may not be initialized yet
      }
    }

    return jobs;
  }

  startPolling(intervalMs: number = 5000): void {
    if (this.pollingInterval) {
      return; // Already polling
    }

    this.logger.debug(`Starting queue config polling every ${intervalMs}ms`);

    this.pollingInterval = setInterval(async () => {
      try {
        const pointer = await this.configService.get<ActivePluginPointer>(
          "queue:active",
          activePluginPointerSchema,
          1,
        );

        if (pointer && pointer.version !== this.configVersion) {
          this.logger.info(
            `🔄 Queue configuration changed (v${this.configVersion} → v${pointer.version}), reloading...`,
          );
          await this.reloadConfiguration(pointer);
        }
      } catch (error) {
        this.logger.error("Error polling queue config", error);
      }
    }, intervalMs);
  }

  private async reloadConfiguration(
    pointer: ActivePluginPointer,
  ): Promise<void> {
    // Load new plugin config
    const plugin = this.registry.getPlugin(pointer.activePluginId);
    if (!plugin) {
      this.logger.error(
        `Queue plugin '${pointer.activePluginId}' not found during reload`,
      );
      return;
    }

    const config = await this.configService.get(
      pointer.activePluginId,
      plugin.configSchema,
      plugin.configVersion,
    );

    if (!config) {
      this.logger.error(
        `Failed to load config for plugin '${pointer.activePluginId}'`,
      );
      return;
    }

    // Stop and switch all queues
    for (const [name, proxy] of this.queueProxies.entries()) {
      try {
        const newQueue = plugin.createQueue(name, config, this.logger);
        await proxy.switchDelegate(newQueue);
      } catch (error) {
        this.logger.error(`Failed to switch queue '${name}'`, error);
      }
    }

    // Update state
    this.activePluginId = pointer.activePluginId;
    this.activeConfig = config;
    this.configVersion = pointer.version;

    this.logger.info(
      `✅ Queue configuration reloaded: plugin=${this.activePluginId}`,
    );
  }

  async shutdown(): Promise<void> {
    // Stop polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }

    // Stop all queues
    this.logger.info("🛑 Shutting down all queues...");
    for (const [name, proxy] of this.queueProxies.entries()) {
      try {
        await proxy.stop();
        this.logger.debug(`Stopped queue: ${name}`);
      } catch (error) {
        this.logger.error(`Failed to stop queue ${name}`, error);
      }
    }

    this.logger.info("✅ All queues shut down");
  }
}
