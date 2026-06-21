---
"@checkstack/frontend": minor
"@checkstack/ui": minor
"@checkstack/command-frontend": minor
"@checkstack/auth-frontend": minor
"@checkstack/secrets-frontend": minor
"@checkstack/notification-frontend": minor
"@checkstack/pluginmanager-frontend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/integration-frontend": minor
"@checkstack/infrastructure-frontend": minor
"@checkstack/script-packages-frontend": minor
---

Improve sidebar navigation and information architecture:

- Split the overloaded "Configuration" group into focused sections: "Settings"
  (Auth Settings, Teams, Secrets, Notification Settings), "Platform" (Plugins,
  GitOps, Integrations, Infrastructure), and "Developer" (Script Packages,
  Script Sandbox).
- Unify nav active-state on a single shared `isNavRouteActive` helper so the
  sidebar rail and the shared `NavItem` both prefix-match section roots
  (child/detail routes now highlight the parent entry consistently).
- Mark the external Docs entry with an external-link icon so it is clear which
  entries leave the app.
- Add an "Expand all" affordance to recover from a fully-collapsed sidebar.
- Flatten single-entry groups (e.g. Automation) into top-level items, skipping
  the redundant group header.
- Add an in-drawer search entry to the mobile navigation (opens the Cmd+K
  palette) and auto-expand the group containing the active route when the
  drawer opens.
