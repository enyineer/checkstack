import type { Permission } from "@checkmate-monitor/common";

/**
 * Hook definition for type-safe event emission and subscription
 */
export interface Hook<T = unknown> {
  id: string;
  _type?: T; // Phantom type for TypeScript inference
}

/**
 * Create a typed hook
 */
export function createHook<T>(id: string): Hook<T> {
  return { id } as Hook<T>;
}

/**
 * Core platform hooks
 */
export const coreHooks = {
  /**
   * Emitted when a plugin registers permissions
   */
  permissionsRegistered: createHook<{
    pluginId: string;
    permissions: Permission[];
  }>("core.permissions.registered"),

  /**
   * Emitted when plugin configuration is updated
   */
  configUpdated: createHook<{
    pluginId: string;
    key: string;
    value: unknown;
  }>("core.config.updated"),

  /**
   * Emitted when a plugin completes initialization (Phase 2)
   */
  pluginInitialized: createHook<{
    pluginId: string;
  }>("core.plugin.initialized"),

  /**
   * Distributed request to deregister a plugin.
   * All instances receive this and should perform local cleanup.
   * Emitted via broadcast mode.
   */
  pluginDeregistrationRequested: createHook<{
    pluginId: string;
    deleteSchema: boolean;
  }>("core.plugin.deregistration-requested"),

  /**
   * INSTANCE-LOCAL: Emitted BEFORE a plugin begins shutdown on THIS instance.
   * Use emitLocal() to emit this hook - it does NOT go through the Queue.
   * Listeners should perform cleanup that depends on cross-plugin services.
   */
  pluginDeregistering: createHook<{
    pluginId: string;
    reason: "uninstall" | "disable" | "shutdown";
  }>("core.plugin.deregistering"),

  /**
   * Emitted AFTER a plugin has been fully removed.
   * Use this for orphan cleanup (e.g., removing permissions from DB).
   * Should be emitted with work-queue mode for DB operations.
   */
  pluginDeregistered: createHook<{
    pluginId: string;
  }>("core.plugin.deregistered"),

  /**
   * Emitted when the platform is shutting down.
   * Gives plugins time to gracefully cleanup resources.
   */
  platformShutdown: createHook<{
    reason: "signal" | "error" | "manual";
  }>("core.platform.shutdown"),

  // ─────────────────────────────────────────────────────────────────────────
  // Plugin Installation (Multi-Instance Coordination)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Distributed request to install/enable a plugin.
   * All instances receive this and should load the plugin into memory.
   * Emitted via broadcast mode.
   */
  pluginInstallationRequested: createHook<{
    pluginId: string;
    pluginPath: string;
  }>("core.plugin.installation-requested"),

  /**
   * INSTANCE-LOCAL: Emitted when a plugin is being loaded on THIS instance.
   * Use emitLocal() to emit this hook - it does NOT go through the Queue.
   */
  pluginInstalling: createHook<{
    pluginId: string;
  }>("core.plugin.installing"),

  /**
   * Emitted AFTER a plugin has been fully installed and loaded.
   * Use this for post-installation tasks (e.g., syncing to DB).
   * Should be emitted with work-queue mode for DB operations.
   */
  pluginInstalled: createHook<{
    pluginId: string;
  }>("core.plugin.installed"),
} as const;

/**
 * Hook subscription options using discriminated union for type safety.
 *
 * When mode is 'work-queue', workerGroup is REQUIRED at compile-time.
 * When mode is 'broadcast', workerGroup is not allowed.
 */
export type HookSubscribeOptions =
  | {
      /**
       * Broadcast mode: All instances receive and process the hook
       */
      mode?: "broadcast";
      /**
       * Not allowed in broadcast mode
       */
      workerGroup?: never;
      /**
       * Maximum retry attempts (not used in broadcast mode)
       */
      maxRetries?: number;
    }
  | {
      /**
       * Work-queue mode: Only one instance processes (load-balanced with retry)
       */
      mode: "work-queue";
      /**
       * Worker group identifier. REQUIRED for work-queue mode.
       *
       * Workers with the same group name compete (only one processes the message).
       * Workers with different group names both process the message.
       *
       * Automatically namespaced by plugin ID to prevent conflicts.
       *
       * Examples:
       * - 'db-sync' → becomes 'my-plugin.db-sync'
       * - 'email-sender' → becomes 'my-plugin.email-sender'
       */
      workerGroup: string;
      /**
       * Maximum retry attempts for work-queue mode
       * @default 3
       */
      maxRetries?: number;
    }
  | {
      /**
       * Instance-local mode: Events bypass the Queue and run in-memory only.
       * Use for cleanup hooks that should NOT be distributed across instances.
       * Emitted via emitLocal() instead of emit().
       */
      mode: "instance-local";
      /**
       * Not allowed in instance-local mode
       */
      workerGroup?: never;
      /**
       * Not applicable in instance-local mode
       */
      maxRetries?: never;
    };

/**
 * Handle for unsubscribing from a hook
 */
export interface HookUnsubscribe {
  (): Promise<void>;
}
