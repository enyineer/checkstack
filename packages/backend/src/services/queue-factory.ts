import { Queue, QueueFactory } from "@checkmate/queue-api";
import { QueuePluginRegistryImpl } from "./queue-plugin-registry";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { queueConfiguration } from "../schema";
import { Logger } from "@checkmate/backend-api";
import * as schema from "../schema";

type Db = NodePgDatabase<typeof schema>;

export class QueueFactoryImpl implements QueueFactory {
  private activePluginId: string = "memory"; // Default
  private activeConfig: unknown = { concurrency: 10, maxQueueSize: 10_000 };

  constructor(
    private registry: QueuePluginRegistryImpl,
    private db: Db,
    private logger: Logger
  ) {}

  async loadConfiguration(): Promise<void> {
    try {
      const configs = await this.db.select().from(queueConfiguration).limit(1);

      if (configs.length > 0) {
        this.activePluginId = configs[0].pluginId;
        this.activeConfig = configs[0].config;
        this.logger.info(
          `📋 Loaded queue configuration: plugin=${this.activePluginId}`
        );
      } else {
        this.logger.info(
          `📋 No queue configuration found, using default: plugin=${this.activePluginId}`
        );
      }
    } catch (error) {
      this.logger.error("Failed to load queue configuration", error);
      // Continue with defaults
    }
  }

  createQueue<T>(name: string): Queue<T> {
    const plugin = this.registry.getPlugin(this.activePluginId);
    if (!plugin) {
      throw new Error(`Queue plugin '${this.activePluginId}' not found`);
    }
    return plugin.createQueue(name, this.activeConfig);
  }

  getActivePlugin(): string {
    return this.activePluginId;
  }

  async setActivePlugin(pluginId: string, config: unknown): Promise<void> {
    // Validate plugin exists
    const plugin = this.registry.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`Plugin '${pluginId}' not found`);
    }

    // Validate config against schema
    plugin.configSchema.parse(config);

    // Save to database
    await this.db
      .insert(queueConfiguration)
      .values({
        pluginId,
        config: config as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [queueConfiguration.id],
        set: {
          pluginId,
          config: config as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });

    this.activePluginId = pluginId;
    this.activeConfig = config;

    this.logger.info(`📋 Updated queue configuration: plugin=${pluginId}`);
  }
}
