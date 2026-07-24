---
"@checkstack/status-page-frontend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/ui": minor
---

Make maintenance status colours agree across every surface

Thanks to @stuajnht for reporting: a "Scheduled" maintenance was blue on the
manage/list/detail pages, amber on the catalog system card, and grey on the
status page block and the public maintenance detail page - three different
colours for one status.

The manage surfaces went through the canonical `presentMaintenanceStatus`
mapping (blue `info` for scheduled, amber `warn` for in-progress); the other
three hardcoded Tailwind classes and never consulted it. Two of them hardcoded
the grey `unknown` tone for EVERY status, so they also painted an in-progress
window grey, and rendered the raw enum ("in progress") instead of the shared
label ("In Progress"). The catalog card hardcoded amber for every status, so a
scheduled-only window looked identical to a live one.

All three now derive tone and label from the canonical mapping:

- **status-page-frontend** gains `maintenanceStatusTone` /
  `maintenanceStatusLabel`, replicated against the shared `pillToneStyles`
  tones - the same platform-layer arrangement `severityTone.ts` already uses,
  since status-page-frontend must not import the domain `maintenance-*`
  packages. The public maintenance block, the public detail page, and the
  system-level "Maintenance" status pill all read from it. A system under
  planned maintenance now reads blue (informational), not grey (inert/unknown).
- **maintenance-frontend**'s system detail card takes the tone of whichever
  window leads: amber while one is in progress, else blue for scheduled.

Separately, `StatusBadge` now draws from the shared status tokens
(`--status-*`) instead of the generic `--success`/`--warning`/`--info`
palette. Those palettes differ (e.g. `--info` 217 91% 60% vs `--status-info`
214 90% 45%), so a system-state badge and a status pill of the same tone
rendered two different blues (and two different ambers) for the same meaning.
They now share one hue per tone across health, incident, SLO, maintenance,
anomaly and dependency badges.
