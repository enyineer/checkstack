import { pluginRegistry } from "../plugin-registry";
import type { SlotContext } from "../plugin";
import type { SlotDefinition } from "../slots";

/**
 * Type-safe props for ExtensionSlot.
 * Extracts the context type from the slot definition itself,
 * ensuring the context matches what the slot expects.
 */
type ExtensionSlotProps<TSlot extends SlotDefinition<unknown>> =
  SlotContext<TSlot> extends undefined
    ? { slot: TSlot; context?: undefined }
    : { slot: TSlot; context: SlotContext<TSlot> };

/**
 * Renders all extensions registered for the given slot.
 *
 * @example
 * ```tsx
 * // Slot with context - context is required and type-checked
 * <ExtensionSlot slot={SystemDetailsSlot} context={{ system }} />
 *
 * // Slot without context
 * <ExtensionSlot slot={NavbarRightSlot} />
 * ```
 */
export function ExtensionSlot<TSlot extends SlotDefinition<unknown>>({
  slot,
  context,
}: ExtensionSlotProps<TSlot>) {
  const extensions = pluginRegistry.getExtensions(slot.id);

  if (extensions.length === 0) {
    return <></>;
  }

  return (
    <>
      {extensions.map((ext) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Component = ext.component as React.ComponentType<any>;
        return <Component key={ext.id} {...(context ?? {})} />;
      })}
    </>
  );
}
