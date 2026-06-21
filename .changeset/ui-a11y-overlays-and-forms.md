---
"@checkstack/ui": minor
---

Accessibility: rebuild overlays on accessible primitives and add form error/required affordances.

- `ConfirmationModal` is now built on the accessible `Dialog` primitive: focus
  trap, Escape-to-close, focus restoration to the trigger, and body scroll-lock.
  Its confirm button now goes through the shared `Button` variant system
  (`destructive` for `danger`) instead of a re-implemented class string. Public
  prop API is unchanged.
- `Tooltip` is rebuilt on `@radix-ui/react-tooltip`: the trigger is a focusable
  button (keyboard- and screen-reader-reachable), Radix supplies `role="tooltip"`
  and collision-aware placement, and content portals into the nearest
  Dialog/Sheet when nested. The `{ content, className }` API is unchanged; a new
  optional `children` prop allows a custom trigger.
- Form primitives gain additive accessibility props: `Input` accepts `invalid`
  (destructive styling + `aria-invalid`), `Label` accepts `required` (token-
  colored `*` plus an `sr-only` "(required)" so the requirement is not color-
  only), and a new `FormError` component renders `role="alert"` inline errors.
  `DynamicForm`/`FormField` wire these (`aria-invalid` + `aria-describedby`) for
  fields with inline validation errors. No existing call site changes.
