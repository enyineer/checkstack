import { memo, type ComponentType } from "react";
import type { Extension, SlotContext } from "../plugin";
import type { SlotDefinition } from "../slots";
import { useSlotExtensions } from "../use-slot-extensions";
import { getLazyContribution } from "./LazyContribution";

/**
 * Render a single extension's UI, handling both contribution kinds: an eager
 * `component` renders directly; a lazy `load` renders through
 * {@link getLazyContribution} (code-split + Suspense + per-plugin error
 * boundary). Use this when you drive rendering yourself from
 * {@link useSlotExtensions} (e.g. a tab bar that renders only the active tab);
 * for rendering ALL of a slot's extensions, use {@link ExtensionSlot}.
 */
export function ExtensionComponent<
  TSlot extends SlotDefinition<unknown, unknown>
>({
  extension,
  context,
}: {
  extension: Extension<TSlot>;
  context?: SlotContext<TSlot>;
}) {
  // The slot's context was type-checked against this extension at registration
  // time (createSlotExtension); it's erased to a props bag for rendering.
  const props = (context ?? {}) as Record<string, unknown>;

  if (extension.component) {
    const Component = extension.component as ComponentType<
      Record<string, unknown>
    >;
    return <Component {...props} />;
  }
  if (extension.load) {
    const Lazy = getLazyContribution({
      id: extension.id,
      load: extension.load as () => Promise<{
        default: ComponentType<Record<string, unknown>>;
      }>,
    });
    return <Lazy {...props} />;
  }
  return null;
}

/**
 * Shallow equality over a slot context's OWN enumerable values: same key set,
 * `Object.is`-equal values. Slot call sites build the context object inline
 * (`context={{ systemId, ... }}`), so object identity changes every parent
 * render even when nothing meaningful did - comparing the VALUES lets the
 * memoized extension renderer bail out. Exported for the regression test.
 */
export function slotContextEquals(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]),
  );
}

/**
 * Memoized extension renderer used by {@link ExtensionSlot}. A slot mounted
 * per ROW (e.g. the catalog manager's system actions, where every visible row
 * hosts several plugin fillers, each running auth/query hooks) would
 * otherwise re-render EVERY filler on EVERY parent render - typing in the
 * table's filter re-ran hundreds of hook trees and profiled as a
 * GC-dominated main-thread storm. Extensions are registry-stable and contexts
 * compare by value, so an unchanged row costs nothing on a parent render.
 *
 * For the bail-out to work, slot call sites must keep context VALUES
 * referentially stable: primitives are free; memoize arrays/objects/functions
 * (e.g. `visibleSystemIds` via `useMemo`).
 */
const MemoizedExtensionComponent = memo(
  ExtensionComponent,
  (prev, next) =>
    prev.extension === next.extension &&
    slotContextEquals(
      // The generic context is erased to a props bag at render time (see
      // ExtensionComponent); the comparator reads it the same way.
      prev.context as Record<string, unknown> | undefined,
      next.context as Record<string, unknown> | undefined,
    ),
  // React.memo erases ExtensionComponent's generic signature; restore it so
  // call sites keep full slot-context type checking.
) as typeof ExtensionComponent;

/**
 * Type-safe props for ExtensionSlot.
 * Extracts the context type from the slot definition itself,
 * ensuring the context matches what the slot expects.
 */
type ExtensionSlotProps<TSlot extends SlotDefinition<unknown, unknown>> =
  SlotContext<TSlot> extends undefined
    ? { slot: TSlot; context?: undefined }
    : { slot: TSlot; context: SlotContext<TSlot> };

/**
 * Renders all extensions registered for the given slot.
 *
 * Subscribes to the plugin registry (via {@link useSlotExtensions}), so
 * extensions contributed by plugins loaded AT RUNTIME (installed remotely)
 * appear without a manual refresh. Eager (`component`) extensions render
 * directly; lazy (`load`) extensions render through {@link getLazyContribution}
 * (code-split + Suspense + per-plugin error boundary).
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
export function ExtensionSlot<TSlot extends SlotDefinition<unknown, unknown>>({
  slot,
  context,
}: ExtensionSlotProps<TSlot>) {
  const extensions = useSlotExtensions(slot);

  if (extensions.length === 0) {
    return <></>;
  }

  // Sort by priority (ascending, lower first) when the extension declares one.
  // Extensions without a priority default to 0. Uses a stable sort so
  // equal-priority extensions keep their registration order.
  const sorted = extensions.toSorted(
    (a, b) =>
      ((a.metadata as { priority?: number } | undefined)?.priority ?? 0) -
      ((b.metadata as { priority?: number } | undefined)?.priority ?? 0),
  );

  return (
    <>
      {sorted.map((ext) => (
        <MemoizedExtensionComponent
          key={ext.id}
          extension={ext}
          context={context}
        />
      ))}
    </>
  );
}
