---
"@checkstack/status-page-frontend": minor
---

Public status page polish and accessible builder confirmations.

- The public status page now re-fetches its published snapshot every 60s
  (bounded `refetchInterval`) so the "Updated" timestamp stays honest while a
  visitor watches during an incident, with an "auto-updates every minute"
  affordance. The not-found and empty states now use the shared `EmptyState`
  for visual consistency.
- The status page builder replaces the native `globalThis.confirm` prompts
  (remove verified custom domain, discard unsaved changes) with the accessible
  `ConfirmationModal`, so those high-stakes flows are themed, keyboard-/screen-
  reader-accessible, and show a busy state.
