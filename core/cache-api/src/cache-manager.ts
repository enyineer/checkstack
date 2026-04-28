import type { CacheProvider } from "./cache-provider";

/**
 * CacheManager handles cache provider lifecycle and backend switching.
 *
 * Simpler than QueueManager — no proxy pattern needed since cache is stateless key/value.
 * The active provider is replaced atomically on backend switch.
 */
export interface CacheManager {
  /**
   * Get the currently active CacheProvider.
   * Returns a singleton provider for the active backend.
   */
  getProvider(): CacheProvider;

  /**
   * Get the currently active cache plugin ID.
   */
  getActivePlugin(): string;

  /**
   * Get the currently active cache plugin configuration.
   */
  getActiveConfig(): unknown;

  /**
   * Switch to a different cache backend.
   * The old provider is shut down and replaced with a new one.
   *
   * @throws Error if connection test fails
   */
  setActiveBackend(pluginId: string, config: unknown): Promise<void>;

  /**
   * Gracefully shutdown the active cache provider.
   */
  shutdown(): Promise<void>;
}
