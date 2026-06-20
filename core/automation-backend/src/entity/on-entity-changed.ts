/**
 * Public cross-plugin entity-change subscription service (reactive
 * automation engine §6.1 design decision).
 *
 * Other plugins (slo-backend, dependency-backend, …) must react to ANOTHER
 * domain's entity changes WITHOUT touching the internal `ENTITY_CHANGED`
 * hook, which stays unexported so `defineEntity` remains the only typed path
 * that EMITS a change. This service is the typed, validated path that
 * CONSUMES changes: a subscriber names the `kind` it cares about and gets a
 * handler called with `{ kind, id, prev, next, delta, changedFields, actor }`
 * for every matching change.
 *
 * ## Delivery semantics
 *
 * Two modes, picked by the subscriber:
 *
 *   - `"broadcast"` (DEFAULT): every instance's handler runs for every
 *     change. Correct for reactors that maintain PER-INSTANCE state — an
 *     in-memory cache to invalidate, a local fan-out, a websocket push. A
 *     cleanup reactor that must touch each instance wants this.
 *   - `"work-queue"`: exactly one instance in the cluster runs the handler
 *     per change (load-balanced, retried). Correct for "do this side-effect
 *     once per change" work (write a derived row, enqueue a notification).
 *     Requires a `workerGroup` so distinct subscribers don't share a claim.
 *
 * The default is broadcast because the safe failure mode of "every instance
 * reacts" is redundant work, whereas a wrong work-queue grouping silently
 * DROPS a reactor's delivery on all but one instance — a far worse default
 * for a cross-plugin API whose callers can't see the engine's internals.
 *
 * Subscriptions are registered eagerly (during another plugin's
 * `register`/`init`) and the actual `onHook` wiring is deferred until
 * automation-backend's `afterPluginsReady` (the only place `onHook` is
 * injected, §3.7) — exactly like the change emitter buffers emits.
 */
import {
  EntityChangedSchema,
  type EntityChanged,
} from "@checkstack/automation-common";
import type { HookEventMeta, Logger } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";

import { ENTITY_CHANGED_HOOK } from "./hook";

/** Payload delivered to an `onEntityChanged` handler (the validated change). */
export type EntityChangedDelivery = EntityChanged;

/** Handler invoked for each matching entity change. */
export type EntityChangedHandler = (
  change: EntityChangedDelivery,
) => Promise<void> | void;

export interface OnEntityChangedInput {
  /** Entity kind to subscribe to (e.g. `"health"`, `"incident"`). */
  kind: string;
  /** Called for every change of `kind`. */
  handler: EntityChangedHandler;
  /**
   * Delivery semantics. Defaults to `"broadcast"` (every instance). Use
   * `"work-queue"` for exactly-once-per-cluster work; a `workerGroup` is
   * then required so distinct subscribers don't compete for one claim.
   */
  delivery?:
    | { mode?: "broadcast" }
    | { mode: "work-queue"; workerGroup: string; maxRetries?: number };
}

/** Unsubscribe handle. Idempotent. */
export type EntityChangedUnsubscribe = () => Promise<void>;

/**
 * The public surface registered on the entity extension point. Callable
 * from another plugin's `register`/`init`; the underlying hook subscription
 * is wired when automation-backend reaches `afterPluginsReady`.
 */
export type OnEntityChanged = (
  input: OnEntityChangedInput,
) => EntityChangedUnsubscribe;

/** Type of the `onHook` fn injected in afterPluginsReady (mirrors backend-api). */
export type OnHookFn = <T>(
  hook: { id: string; _type?: T },
  listener: (payload: T, meta?: HookEventMeta) => Promise<void>,
  options?:
    | { mode?: "broadcast"; maxRetries?: number }
    | { mode: "work-queue"; workerGroup: string; maxRetries?: number }
    | { mode: "instance-local" },
) => () => Promise<void>;

interface PendingSubscription {
  input: OnEntityChangedInput;
  /** Set once wired; calling it unsubscribes the live hook. */
  liveUnsub?: () => Promise<void>;
  /** True once the caller unsubscribed before wiring completed. */
  cancelled: boolean;
}

export interface EntityChangedSubscriptions {
  /** The `onEntityChanged` impl exposed on the entity extension point. */
  readonly onEntityChanged: OnEntityChanged;
  /**
   * Wire every pending (and future) subscription to the real `onHook`.
   * Called once from automation-backend's `afterPluginsReady`.
   */
  wire(args: { onHook: OnHookFn; logger: Logger }): void;
  /** Tear down every live subscription (cleanup). */
  disposeAll(): Promise<void>;
}

export function createEntityChangedSubscriptions(): EntityChangedSubscriptions {
  const pending: PendingSubscription[] = [];
  let wiring:
    | { onHook: OnHookFn; logger: Logger }
    | undefined;

  /** Build the listener that validates + filters by kind + invokes handler. */
  function makeListener(
    sub: PendingSubscription,
    logger: Logger,
  ): (payload: EntityChanged, meta?: HookEventMeta) => Promise<void> {
    return async (payload) => {
      // Validate the wire payload (defensive — the hook is internal, but the
      // public API contract is the validated shape).
      const parsed = EntityChangedSchema.safeParse(payload);
      if (!parsed.success) {
        logger.warn(
          `onEntityChanged(${sub.input.kind}): dropping malformed ENTITY_CHANGED payload`,
        );
        return;
      }
      if (parsed.data.kind !== sub.input.kind) return;
      try {
        await sub.input.handler(parsed.data);
      } catch (error) {
        logger.warn(
          `onEntityChanged(${sub.input.kind}) handler threw: ${extractErrorMessage(error)}`,
        );
      }
    };
  }

  /** Wire one subscription to the live hook. */
  function wireOne(
    sub: PendingSubscription,
    onHook: OnHookFn,
    logger: Logger,
  ): void {
    if (sub.cancelled) return;
    const delivery = sub.input.delivery;
    const listener = makeListener(sub, logger);
    const unsub =
      delivery && delivery.mode === "work-queue"
        ? onHook(ENTITY_CHANGED_HOOK, listener, {
            mode: "work-queue",
            workerGroup: delivery.workerGroup,
            maxRetries: delivery.maxRetries,
          })
        : onHook(ENTITY_CHANGED_HOOK, listener, { mode: "broadcast" });
    sub.liveUnsub = unsub;
  }

  const onEntityChanged: OnEntityChanged = (input) => {
    if (typeof input.kind !== "string" || input.kind.trim().length === 0) {
      throw new Error("onEntityChanged: `kind` must be a non-empty string");
    }
    if (
      input.delivery &&
      input.delivery.mode === "work-queue" &&
      (!input.delivery.workerGroup ||
        input.delivery.workerGroup.trim().length === 0)
    ) {
      throw new Error(
        "onEntityChanged: work-queue delivery requires a non-empty `workerGroup`",
      );
    }

    const sub: PendingSubscription = { input, cancelled: false };
    pending.push(sub);
    // If wiring already happened, wire immediately.
    if (wiring) wireOne(sub, wiring.onHook, wiring.logger);

    return async () => {
      sub.cancelled = true;
      if (sub.liveUnsub) {
        const unsub = sub.liveUnsub;
        sub.liveUnsub = undefined;
        await unsub();
      }
    };
  };

  return {
    onEntityChanged,
    wire({ onHook, logger }) {
      wiring = { onHook, logger };
      for (const sub of pending) {
        if (!sub.liveUnsub) wireOne(sub, onHook, logger);
      }
    },
    async disposeAll() {
      for (const sub of pending) {
        sub.cancelled = true;
        if (sub.liveUnsub) {
          const unsub = sub.liveUnsub;
          sub.liveUnsub = undefined;
          try {
            await unsub();
          } catch {
            // best-effort cleanup
          }
        }
      }
    },
  };
}
