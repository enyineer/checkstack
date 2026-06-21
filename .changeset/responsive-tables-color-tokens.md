---
"@checkstack/announcement-frontend": minor
"@checkstack/auth-frontend": minor
"@checkstack/automation-frontend": minor
"@checkstack/catalog-frontend": minor
"@checkstack/dependency-frontend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/notification-frontend": minor
"@checkstack/pluginmanager-frontend": minor
"@checkstack/queue-frontend": minor
"@checkstack/satellite-frontend": minor
"@checkstack/script-packages-frontend": minor
"@checkstack/slo-frontend": minor
---

Make data-dense tables mobile-friendly and align status colors with semantic tokens.

- Migrated the remaining data-dense tables to the `ResponsiveTable` + `MobileCardList` dual-layout: catalog (Systems/Groups/Environments), incident config, maintenance config + system history, announcement management, notification delivery attempts, plugin manager (installed plugins + events), satellite list, automation list, healthcheck runs, OAuth applications, and the queue runtime panel. On viewports below `sm` these now render stacked cards surfacing the high-priority fields instead of an overflowing table. Genuinely narrow or runtime-diagnostic panels (cache runtime, healthcheck history, anomaly mute list) were intentionally left as plain tables.
- Swapped hardcoded semantic status colors for design tokens (`text-warning`, `text-success`, `text-destructive`, `text-muted-foreground`) in GitOps provenance status, healthcheck editor warnings, dependency canvas node status, automation run-step status, queue runtime tone map, and script-packages settings. Chart-series literals, syntax/terminal palettes, and intentional brand accents (tips lightbulb, SLO streak flame ramp) were left untouched.
- Extracted pure display/validation logic into sibling `.logic.ts` modules (SLO display + editor, maintenance editor + config summary, dependency display, incident sort + validation, gitops kind-registry YAML) so it can be unit-tested in isolation. These extractions are behavior-preserving.
