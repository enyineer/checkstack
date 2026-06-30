---
"@checkstack/healthcheck-frontend": minor
---

Add search, filters, and name sorting to the Health Checks overview.

The "Health Checks" config page now ships a toolbar with a name search, a
strategy filter, an active/paused status filter, and a "show all assigned to
system X" filter. Results are sorted by name (case-insensitive). Filter state
is held in URL params (shareable links) and debounced for smooth typing.

Because a health-check configuration carries no system field of its own (the
assignment is a separate entity), the system filter resolves the assigned
config id set for the selected system via `getSystemConfigurations` and
intersects it with the loaded configurations.
