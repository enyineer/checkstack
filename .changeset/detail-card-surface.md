---
"@checkstack/ui": minor
"@checkstack/catalog-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/dependency-frontend": patch
"@checkstack/slo-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/anomaly-frontend": patch
"@checkstack/maintenance-frontend": patch
---

The Logs, Metrics, and Traces cards on the system overview page now match the
other cards. They had drifted to a flat `bg-card` background with a
hairline-only shadow, so they rendered visibly flatter than their siblings
(health, dependency, SLO, incident, anomaly, maintenance), which all use the
detail-page gradient plus a soft two-layer elevation shadow.

The shared card surface is now a single primitive - `DetailCard` (and the
`detailCardSurface` / `detailCardSurfaceFlat` class constants) in
`@checkstack/ui` - instead of a className that was copy-pasted (and could
diverge) in every system-overview card. All of those cards now render from the
one primitive, so they cannot drift apart again. A new `error`-level ESLint
rule `checkstack/no-inline-detail-card-chrome` fails the build if a card in that
family re-declares the surface inline instead of using `DetailCard`.
