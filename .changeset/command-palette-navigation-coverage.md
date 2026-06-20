---
"@checkstack/dependency-backend": patch
"@checkstack/status-page-backend": patch
"@checkstack/satellite-backend": patch
"@checkstack/gitops-backend": patch
"@checkstack/secrets-backend": patch
"@checkstack/notification-backend": patch
"@checkstack/script-packages-backend": patch
---

Widen Cmd+K command-palette coverage to every top-level sidebar destination.

The command palette previously only surfaced commands from a handful of plugins,
so large feature areas were silently unreachable from search. Each of these
plugins now registers a "navigate to <feature>" command per top-level route via
`registerSearchProvider`, so every sidebar destination they own is reachable
from Cmd+K (entity search can come later):

- dependency: "Dependency Map"
- status-page: "Status pages"
- satellite: "Satellites"
- gitops: "GitOps", "Kind Registry"
- secrets: "Secrets"
- notification: "Notification Settings"
- script-packages: "Script Packages", "Script Sandbox"

Each command reuses the plugin's own route helper (`resolveRoute`) for its href
and carries the same access rule that gates its sidebar nav entry, so palette
visibility matches sidebar visibility. The notification command carries no
access rule, matching its authenticated-only nav entry.
