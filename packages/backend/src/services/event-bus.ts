import type { Queue, QueueFactory } from "@checkmate/queue-api";
import type {
  Hook,
  HookSubscribeOptions,
  HookUnsubscribe,
  Logger,
} from "@checkmate/backend-api";
import type { EventBus as IEventBus } from "@checkmate/backend-api";

export type HookListener<T> = (payload: T) => Promise<void>;

interface ListenerRegistration {
  id: string;
  pluginId: string;
  hookId: string;
  consumerGroup: string;
  listener: HookListener<unknown>;
  mode: "broadcast" | "work-queue";
}

/**
 * EventBus service for distributed event/hook system
 *
 * Leverages the Queue system to provide pub/sub patterns that work
 * across multiple backend instances.
 */
export class EventBus implements IEventBus {
  private queueChannels = new Map<string, Queue<unknown>>();
  private listeners = new Map<string, ListenerRegistration[]>();
  private workerGroups = new Map<string, Set<string>>(); // pluginId -> Set<workerGroup>
  private instanceId = crypto.randomUUID();

  constructor(private queueFactory: QueueFactory, private logger: Logger) {}

  /**
   * Subscribe to a hook
   */
  async subscribe<T>(
    pluginId: string,
    hook: Hook<T>,
    listener: HookListener<T>,
    options: HookSubscribeOptions = {}
  ): Promise<HookUnsubscribe> {
    // Type narrowing for discriminated union
    const mode = options.mode ?? "broadcast";
    const workerGroup =
      "workerGroup" in options ? options.workerGroup : undefined;
    const maxRetries = options.maxRetries ?? 3;

    // Validation: workerGroup required for work-queue mode
    if (mode === "work-queue" && !workerGroup) {
      throw new Error(
        `workerGroup is required when mode is 'work-queue' for hook ${hook.id} in plugin ${pluginId}`
      );
    }

    // Duplicate detection
    if (mode === "work-queue" && workerGroup) {
      const pluginWorkerGroups = this.workerGroups.get(pluginId) || new Set();

      if (pluginWorkerGroups.has(workerGroup)) {
        throw new Error(
          `Duplicate workerGroup '${workerGroup}' detected in plugin ${pluginId} for hook ${hook.id}. ` +
            `Each workerGroup must be unique within a plugin.`
        );
      }

      pluginWorkerGroups.add(workerGroup);
      this.workerGroups.set(pluginId, pluginWorkerGroups);
    }

    // Determine consumer group with plugin namespacing
    const consumerGroup =
      mode === "broadcast"
        ? `${pluginId}.${hook.id}.broadcast.${this.instanceId}` // Unique per instance
        : `${pluginId}.${workerGroup}`; // Shared across instances (namespaced)

    const listenerId = crypto.randomUUID();

    const registration: ListenerRegistration = {
      id: listenerId,
      pluginId,
      hookId: hook.id,
      consumerGroup,
      listener: listener as HookListener<unknown>,
      mode,
    };

    const listeners = this.listeners.get(hook.id) || [];
    listeners.push(registration);
    this.listeners.set(hook.id, listeners);

    // Create queue channel if needed
    if (!this.queueChannels.has(hook.id)) {
      const channel = this.queueFactory.createQueue<T>(hook.id);
      this.queueChannels.set(hook.id, channel);

      this.logger.debug(`Created event channel for hook: ${hook.id}`);
    }

    const channel = this.queueChannels.get(hook.id)!;

    // Register consumer with appropriate group
    await channel.consume(
      async (job) => {
        // Find listener by ID and invoke
        const currentListeners = this.listeners.get(hook.id) || [];
        const targetListener = currentListeners.find(
          (l) => l.id === listenerId
        );

        if (targetListener) {
          await this.invokeListener(targetListener, job.data);
        }
      },
      {
        consumerGroup,
        maxRetries: mode === "work-queue" ? maxRetries : 0,
      }
    );

    this.logger.debug(
      `Subscribed to hook ${hook.id} (plugin: ${pluginId}, mode: ${mode}, group: ${consumerGroup})`
    );

    // Return unsubscribe function
    return async () => {
      await this.unsubscribe(pluginId, hook.id, listenerId, workerGroup);
    };
  }

  /**
   * Unsubscribe from a hook
   */
  private async unsubscribe(
    pluginId: string,
    hookId: string,
    listenerId: string,
    workerGroup?: string
  ): Promise<void> {
    // Remove listener registration
    const listeners = this.listeners.get(hookId) || [];
    const updatedListeners = listeners.filter((l) => l.id !== listenerId);

    if (updatedListeners.length === 0) {
      this.listeners.delete(hookId);

      // Stop queue if no more listeners
      const channel = this.queueChannels.get(hookId);
      if (channel) {
        await channel.stop();
        this.queueChannels.delete(hookId);
      }
    } else {
      this.listeners.set(hookId, updatedListeners);
    }

    // Remove from workerGroup tracking
    if (workerGroup) {
      const pluginWorkerGroups = this.workerGroups.get(pluginId);
      if (pluginWorkerGroups) {
        pluginWorkerGroups.delete(workerGroup);
        if (pluginWorkerGroups.size === 0) {
          this.workerGroups.delete(pluginId);
        }
      }
    }

    this.logger.debug(
      `Unsubscribed listener ${listenerId} from hook ${hookId}`
    );
  }

  /**
   * Emit a hook
   */
  async emit<T>(hook: Hook<T>, payload: T): Promise<void> {
    let channel = this.queueChannels.get(hook.id);

    // Create channel lazily if not exists
    if (!channel) {
      channel = this.queueFactory.createQueue<T>(hook.id);
      this.queueChannels.set(hook.id, channel);
    }

    await channel.enqueue(payload);
    this.logger.debug(`Emitted hook: ${hook.id}`);
  }

  /**
   * Invoke a listener with error handling
   */
  private async invokeListener(
    registration: ListenerRegistration,
    payload: unknown
  ): Promise<void> {
    try {
      await registration.listener(payload);
      this.logger.debug(
        `Listener ${registration.id} (${registration.consumerGroup}) processed successfully`
      );
    } catch (error) {
      this.logger.error(
        `Listener ${registration.id} (${registration.consumerGroup}) failed:`,
        error
      );
      throw error; // Let queue handle retry
    }
  }

  /**
   * Shutdown the event bus
   */
  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.queueChannels.values()].map((channel) => channel.stop())
    );
    this.logger.info("EventBus shut down");
  }
}
