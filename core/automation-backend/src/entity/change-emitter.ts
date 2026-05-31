/**
 * Deferred `ENTITY_CHANGED` emitter.
 *
 * `emitHook` is only injected in `afterPluginsReady` (reactive automation
 * engine §3.7). Plugins, however, call `defineEntity` in `init` and may
 * mutate entities during `init`/`afterPluginsReady` before automation-
 * backend's own `afterPluginsReady` runs and wires the emitter. To avoid a
 * silent no-emit window, change events produced before the emitter is set
 * are BUFFERED and flushed (in order) the moment it is wired.
 *
 * Persistence (the entity_state upsert + transition append) is NOT
 * deferred — only the change-event emission is, since the durable store is
 * always the source of truth and Stage-1 routing/wake (later phases)
 * re-reads it.
 */
import type { EntityChanged } from "@checkstack/automation-common";
import type { Logger } from "@checkstack/backend-api";

export type EmitEntityChanged = (payload: EntityChanged) => Promise<void>;

export interface ChangeEmitter {
  /** Emit a change event now, or buffer it until the emitter is wired. */
  emit(payload: EntityChanged): Promise<void>;
  /**
   * Wire the real emitter (called from automation-backend's
   * `afterPluginsReady`). Flushes any buffered events in order.
   */
  wire(emit: EmitEntityChanged): Promise<void>;
  /** Whether the real emitter has been wired. */
  readonly isWired: boolean;
}

export function createChangeEmitter(args?: {
  logger?: Logger;
  /** Cap on buffered events before the emitter is wired (guards a runaway). */
  bufferLimit?: number;
}): ChangeEmitter {
  const logger = args?.logger;
  const bufferLimit = args?.bufferLimit ?? 10_000;
  let emit: EmitEntityChanged | undefined;
  const buffer: EntityChanged[] = [];

  return {
    get isWired() {
      return emit !== undefined;
    },

    async emit(payload) {
      if (emit) {
        await emit(payload);
        return;
      }
      if (buffer.length >= bufferLimit) {
        logger?.warn(
          `entity change buffer full (${bufferLimit}); dropping the oldest buffered ${payload.kind}:${payload.id} change event`,
        );
        buffer.shift();
      }
      buffer.push(payload);
    },

    async wire(realEmit) {
      emit = realEmit;
      if (buffer.length > 0) {
        logger?.debug(
          `flushing ${buffer.length} buffered entity change event(s) on emitter wire`,
        );
      }
      // Drain in arrival order; clearing as we go so a re-entrant emit
      // (an emitter that itself mutates an entity) appends, not duplicates.
      while (buffer.length > 0) {
        const next = buffer.shift();
        if (next) await realEmit(next);
      }
    },
  };
}
