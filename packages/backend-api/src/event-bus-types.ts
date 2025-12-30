import type { Hook, HookSubscribeOptions, HookUnsubscribe } from "./hooks";

/**
 * EventBus interface for dependency injection
 */
export interface EventBus {
  subscribe<T>(
    pluginId: string,
    hook: Hook<T>,
    listener: (payload: T) => Promise<void>,
    options?: HookSubscribeOptions
  ): Promise<HookUnsubscribe>;

  emit<T>(hook: Hook<T>, payload: T): Promise<void>;

  shutdown(): Promise<void>;
}
