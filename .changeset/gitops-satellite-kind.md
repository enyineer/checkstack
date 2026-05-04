---
"@checkstack/satellite-common": minor
"@checkstack/satellite-backend": minor
"@checkstack/satellite-frontend": minor
---

Add a GitOps `Satellite` kind plus a UI affordance for resetting tokens.

GitOps owns satellite **metadata only** — `metadata.name`,
`spec.region`, and `metadata.labels` (used as the satellite's runtime
tags). The bcrypt token is intentionally never expressed in YAML; on
first reconcile a satellite is created with a random token that is
discarded, and operators must use the Satellites page to retrieve a
working credential.

To support that flow:

- New service methods: `updateSatelliteMetadata`, `rotateSatelliteToken`,
  `getSatelliteByName`.
- New RPC procs: `updateSatellite`, `rotateSatelliteToken`.
- New `RotateSatelliteTokenDialog` and a "Reset token" key icon on the
  Satellites list. The dialog reuses the one-time-reveal layout from
  `CreateSatelliteDialog`.
- The Satellites list shows a `GitOpsSourceBadge` next to managed
  satellites and disables the delete button while leaving the
  token-reset button enabled (so operators can always re-issue a
  credential without touching YAML).

The satellite kind reconciler adopts pre-existing satellites by name on
first sync, so this is safe to roll out against installations that
already have manually-created satellites.
