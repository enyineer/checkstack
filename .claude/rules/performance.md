# Performance & Accessibility

Apply this rule when creating or modifying UI components that implement animations, blurs, transitions, or heavy visual effects, to ensure they degrade gracefully on low-power devices and respect user accessibility preferences.

## The `isLowPower` Flag

Always use the `usePerformance` hook from `@checkstack/ui` to detect the device's performance tier. Expensive visual effects MUST be conditionally disabled based on this state.

```tsx
import { usePerformance } from "@checkstack/ui";

const { isLowPower } = usePerformance();
```

## Mandatory Fallbacks

When `isLowPower` is true, you MUST provide a performant alternative design:

1.  **Animations**: Disable infinite animations (e.g., `animate-spin`, `animate-pulse`). Use static icons or text.
2.  **Backdrop Blurs**: Disable `backdrop-blur`. Replace with solid background colors (e.g., `bg-card`).
3.  **Transitions**: Shorten or disable entry/exit transitions (`animate-in`, `fade-in`).
4.  **Complex Effects**: Disable heavy SVG filters, complex gradients, or large-scale blurs (e.g. Aurora blobs).
5.  **Interpolation**: Jump directly to target states for value-based animations (e.g. counters).

## Per-row slot fillers and gated controls

A slot filler mounted PER ROW of a list/table (e.g. `CatalogSystemActionsSlot`
on the catalog manager - every visible row mounts every registered filler)
multiplies whatever it costs by rows x fillers on EVERY parent render. This
has twice produced a GC-dominated main-thread storm that made the catalog
manage page sluggish. Two mechanisms keep it fixed - respect both:

1. **`ExtensionSlot` memoizes fillers on shallow slot-context equality**
   (`slotContextEquals`, guarded by
   `core/frontend-api/src/extension-slot-memo.test.ts`). Inline context
   objects are fine, but every context VALUE must be referentially stable:
   primitives are free; `useMemo` any array/object/function you put in a slot
   context (e.g. `visibleSystemIds`). A per-render array in the context
   silently defeats the bail-out for the whole row.
2. **Keep per-row hook trees lean.** Access hooks (`useCanAccessType`,
   `useResourceAccess`, `useAccessRules`) and `useQuery` each add observers
   per instance. In a per-row component: batch per-resource checks over the
   whole visible list (pass the same `visibleSystemIds` so identical-input
   queries dedupe), never fetch per-row data row-by-row, and avoid adding a
   new hook to a row component without considering rows x fillers cost. If a
   verdict is row-INDEPENDENT, it still costs an observer per row - that is
   acceptable only because the memo bail-out (1) stops the multiplication;
   do not rely on it for genuinely heavy work.

## Rationale

This project targets a wide range of devices. Maintaining an "Engineering-First" aesthetic requires graceful degradation to ensure accessibility and usability on non-hardware-accelerated systems.
