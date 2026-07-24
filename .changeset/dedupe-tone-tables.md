---
"@checkstack/ai-frontend": patch
"@checkstack/anomaly-frontend": patch
"@checkstack/api-docs-frontend": patch
"@checkstack/dashboard-frontend": patch
"@checkstack/dependency-frontend": patch
"@checkstack/gitops-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/integration-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/pluginmanager-frontend": patch
"@checkstack/queue-frontend": patch
"@checkstack/satellite-frontend": patch
"@checkstack/script-packages-frontend": patch
"@checkstack/secrets-frontend": patch
"@checkstack/slo-frontend": patch
---

Source every status tone from the one shared table

Nineteen plugin modules each re-declared the tone-to-class table verbatim
(`pill: "bg-status-ok/10 text-status-ok"`, `dot: "bg-status-ok"`, ...), some
reproducing every field of the shared one. They now take those classes from
`pillToneStyles` in `@checkstack/ui` while keeping their own domain mapping -
which value means which tone - since that is real domain knowledge and is unit
tested. A repo-wide search for a hand-written triad row now returns only the
shared table.

Several hand-rolled pills went with them, onto the shared `StatusPill`: the
automation run pill, the satellite status badge, the notification channel pill,
the SLO objective pill and both AI tool-card pills.

Four rows are deliberately still local, each with a comment saying why, because
they are NOT the shared tone despite looking like it:

- The dashboard's `info` uses the `--info` token, a different hue from
  `--status-info` (light: `217 91% 60%` vs `214 90% 45%`).
- Integrations' and notifications' `unknown`/`neutral` use the muted treatment -
  the ABSENCE of a tone - not the shared grey.
- The queue's "processing" uses opacity-softened muted classes that match
  neither the shared table nor the pill's neutral.

One genuine class divergence was found and NOT normalised: the system incident
panel draws its borders at `/30` where the shared table uses `/20`. It is now a
single documented map instead of a full private table.

Pills whose geometry has no shared equivalent (the dependency canvas node with
its animated halo, the incident panel's compact chips, the dashboard's
non-triad signal tone) keep their markup and now only share the classes.
