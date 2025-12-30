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
    permissions: Array<{ id: string; description?: string }>;
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
   * Emitted when a plugin completes initialization
   */
  pluginInitialized: createHook<{
    pluginId: string;
  }>("core.plugin.initialized"),
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
    };

/**
 * Handle for unsubscribing from a hook
 */
export interface HookUnsubscribe {
  (): Promise<void>;
}
