import { pluginRegistry } from "../plugin-registry";
import type { SlotDefinition } from "../slots";

/**
 * Type-safe props for ExtensionSlot.
 * When TContext is undefined, no context prop is needed.
 * When TContext is defined, context is required with the correct type.
 */
type ExtensionSlotProps<TContext> = TContext extends undefined
  ? { slot: SlotDefinition<TContext>; context?: undefined }
  : { slot: SlotDefinition<TContext>; context: TContext };

/**
 * Renders all extensions registered for the given slot.
 *
 * @example
 * ```tsx
 * // Slot with context - context is required and type-checked
 * <ExtensionSlot slot={SystemDetailsSlot} context={{ system }} />
 *
 * // Slot without context
 * <ExtensionSlot slot={NavbarSlot} />
 * ```
 */
export function ExtensionSlot<TContext = undefined>({
  slot,
  context,
}: ExtensionSlotProps<TContext>) {
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
