import type {
  Hook,
  HookEventMeta,
  HookSubscribeOptions,
  HookUnsubscribe,
} from "./hooks";

/**
 * EventBus interface for dependency injection
 */
export interface EventBus {
  subscribe<T>(
    pluginId: string,
    hook: Hook<T>,
    listener: (payload: T, meta?: HookEventMeta) => Promise<void>,
    options?: HookSubscribeOptions
  ): Promise<HookUnsubscribe>;

  /**
   * Emit a hook through the distributed queue system.
   * All instances receive broadcast hooks; one instance handles work-queue hooks.
   *
   * `meta` carries event-envelope metadata (the acting `actor`). When omitted,
   * the bus defaults to the system actor, so every emitted hook carries an
   * actor even when emitted from a background/unauthenticated context.
   */
  emit<T>(hook: Hook<T>, payload: T, meta?: HookEventMeta): Promise<void>;

  /**
   * Emit a hook locally only (not distributed).
   * Use for instance-local hooks that should only run on THIS instance.
   * Uses Promise.allSettled to ensure one listener error doesn't block others.
   */
  emitLocal<T>(hook: Hook<T>, payload: T, meta?: HookEventMeta): Promise<void>;

  shutdown(): Promise<void>;
}
