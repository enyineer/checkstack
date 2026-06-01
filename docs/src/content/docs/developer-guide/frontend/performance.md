---
title: "Performance degradation"
description: "Gate animation and backdrop-blur classes behind usePerformance().isLowPower, enforced by the checkstack/no-unguarded-animation ESLint rule."
---

Checkstack targets a wide range of devices, so expensive visual effects must
degrade gracefully on low-power hardware. The `.agent/rules/performance.md`
rule mandates that animations, backdrop blurs, and heavy transitions be
disabled when the device reports a low-power tier. The
`checkstack/no-unguarded-animation` ESLint rule is the forcing function that
catches new effects that forget this.

## The canonical guard idiom

Read the device tier from the `usePerformance` hook and gate the effect class
behind `isLowPower`. Use the `cn(...)` helper so the class is dropped entirely
when the device is low-power:

```tsx
import { usePerformance } from "@checkstack/ui";

function LoadingSpinner({ size }: { size: Size }) {
  const { isLowPower } = usePerformance();
  return (
    <svg
      className={cn(
        "text-muted-foreground",
        !isLowPower && "animate-spin",
        sizeClasses[size],
      )}
    />
  );
}
```

A conditional expression works too, and a JS-level guard is fine for
value-based animations (e.g. an animated counter that jumps straight to its
target when `isLowPower` is true):

```tsx
className={isLowPower ? "" : "animate-pulse"}
```

```tsx
if (value === 0 || duration === 0 || isLowPower) {
  setDisplayValue(value);
  return;
}
```

## What the lint rule checks

`checkstack/no-unguarded-animation` runs at `warn` severity over frontend
source only (`core/*-frontend/src`, `plugins/*-frontend/src`, `core/ui/src`).
Storybook stories and test files are excluded. It scans `className` / `class`
attributes and the string arguments of `cn()` / `clsx()` / `cva()`, matching
the `animate-*`, `backdrop-blur*`, `fade-in*`, `fade-out*`, `zoom-in*`,
`zoom-out*`, `slide-in-*`, and `slide-out-*` Tailwind families.

A static lint cannot prove a runtime guard, so the rule biases toward few
false positives:

- A matched class that is the right operand of a logical or conditional
  expression referencing `isLowPower` (the idiom above) is treated as guarded
  and never warned.
- For class strings composed across multiple statements, the rule only warns
  when the enclosing module never references `isLowPower` at all. If the guard
  appears anywhere in the file, the rule assumes the author handled it and
  stays silent.

> [!NOTE]
> The rule is `warn`-only and MUST NOT be escalated to `error` (nor forced
> green via `--max-warnings 0`). It informs authors; it does not block CI.
> See `.agent/rules/code-style-guide.md`.

### Options

Two options mirror the allow-list shape of the other custom rules:

```js
"checkstack/no-unguarded-animation": [
  "warn",
  {
    // Cheap/always-on tokens that never need a guard (exact class match).
    allowedClasses: ["fade-in-0"],
    // Extra guard identifier names beyond the built-in `isLowPower`.
    additionalGuardIdentifiers: ["reduceMotion"],
  },
],
```

## Known gap: CSS @keyframes

The rule cannot see raw CSS `@keyframes` / `animation:` declarations in `.css`
files (e.g. `core/ui/src/themes.css`), because ESLint does not parse CSS and
the guard there is runtime class-swapping rather than a static expression.
Covering that would need a separate stylelint pass or a class-name allow-list
convention. Until then, guard CSS-driven animations by toggling the class that
applies them behind `isLowPower`.
