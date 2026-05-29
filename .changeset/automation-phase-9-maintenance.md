---
"@checkstack/maintenance-backend": minor
---

feat(maintenance): Phase 9 — actions + system-shaped helpers

- Triggers `maintenance.created`, `maintenance.updated` are unchanged;
  they're now lifted out of the inline `register()` block into
  `automations.ts` alongside the new actions.
- Actions `maintenance.create`, `maintenance.update`,
  `maintenance.add_update` wrapping `MaintenanceService`. Each emits
  the appropriate `maintenanceHooks.*` so downstream automations and
  caches react identically to RPC-driven changes; `add_update`
  re-fetches the window before emitting so the hook payload reflects
  the new status.
- The two deferred catalog actions land here as
  `maintenance.set_system` (schedule a `now → now+durationMinutes`
  window covering a single system — the "park this system" operation)
  and `maintenance.clear_system` (close every active or scheduled
  window covering a given system — the "let it back into rotation"
  operation).
- Artifact type `maintenance.window` for downstream steps to consume.
