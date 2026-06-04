---
"@checkstack/ui": minor
"@checkstack/healthcheck-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/integration-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/auth-frontend": patch
"@checkstack/gitops-frontend": patch
---

Guard component animations behind isLowPower, and add a shared inline Spinner.

- `@checkstack/ui` shared components (`Tabs`, `ConfirmationModal`, `Accordion`, `CodeEditor` popout-button backdrop blur) now drop their `animate-*` / `backdrop-blur` classes when the device reports the low-power tier, matching `LoadingSpinner` / `Skeleton`. No public API change; normal-power rendering is unchanged.
- A new shared inline `Spinner` (`@checkstack/ui`) renders a lucide `Loader2` whose `animate-spin` is gated internally behind `usePerformance().isLowPower`, so call sites inherit the low-power guard. Props: `size` (`sm`/`md`/`lg`), `className`, rest spread to the icon; decorative by default (`aria-hidden`), `role="status"` when given `aria-label`. The hand-rolled `Loader2` button/table spinners in `HealthCheckDrawer`, `HealthCheckRunsTable`, `IncidentEditor`, `IncidentUpdateForm`, `ProviderConnectionsPage`, `MaintenanceEditor`, `MaintenanceUpdateForm`, `UserChannelCard`, and `DynamicOptionsField` are migrated onto it.
- Remaining unguarded `animate-*` / `animate-in` / blur classes across the auth, gitops, healthcheck, incident, integration, maintenance, and notification frontends are gated behind `usePerformance().isLowPower`, so effects degrade gracefully on low-power devices per the performance rule.

Normal-power behavior is unchanged; low-power rendering drops the animations.

This is a beta minor.
