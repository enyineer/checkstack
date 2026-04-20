---
trigger: model_decision
description: Use when creating or modifying UI components that implement animations, blurs, transitions, or heavy visual effects
---

# Performance & Accessibility

Use when creating or modifying UI components that implement animations, blurs, transitions, or heavy visual effects to ensure they degrade gracefully on low-power devices and respect user accessibility preferences.

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

## Rationale

This project targets a wide range of devices. Maintaining an "Engineering-First" aesthetic requires graceful degradation to ensure accessibility and usability on non-hardware-accelerated systems.