import { useEffect, useReducer } from "react";
import { pluginRegistry } from "./plugin-registry";
import type { Extension, SlotMetadata } from "./plugin";
import type { SlotDefinition } from "./slots";

/**
 * Strongly-typed extension entry returned by `useSlotExtensions`.
 *
 * `metadata` is typed by the slot's metadata parameter, falling back to
 * `undefined` for slots that declare no metadata.
 */
export type SlotExtensionEntry<TSlot extends SlotDefinition<unknown, unknown>> =
  Extension<TSlot> & {
    metadata: SlotMetadata<TSlot>;
  };

/**
 * Subscribe to all extensions registered for a slot.
 *
 * Re-renders when plugins are registered/unregistered. Use this hook when
 * the consumer needs to do more than just render extensions inline (e.g.
 * read metadata to build a tab bar). For pure render-and-pass-context use,
 * `<ExtensionSlot slot={...} />` remains simpler.
 */
export function useSlotExtensions<TSlot extends SlotDefinition<unknown, unknown>>(
  slot: TSlot
): readonly SlotExtensionEntry<TSlot>[] {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    return pluginRegistry.subscribe(forceUpdate);
  }, []);

  return pluginRegistry.getExtensions(slot.id) as SlotExtensionEntry<TSlot>[];
}

// Re-export helper types alongside the hook.
export type { SlotMetadata, SlotContext } from "./plugin";
