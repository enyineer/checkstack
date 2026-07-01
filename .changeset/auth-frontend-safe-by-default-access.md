---
"@checkstack/auth-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/slo-frontend": minor
---

Add safe-by-default RLAC primitives to `@checkstack/auth-frontend` so a new
management surface is gated by construction instead of re-deriving the hook
boilerplate:

- `<CreateGate>` / `<ManageTypeGate>` render children only when the caller can
  create / reach the surface (thin wrappers over `useCanCreate` /
  `useCanAccessType`, fail-closed while loading).
- `useManageableResources({ items, getId, accessRule, objectType, keepIds?,
  allowAllOverride? })` returns the exact list a resource picker should offer -
  the shared "offer all when entitled, else filter to accessible, keep the
  current selection" policy (`selectManageable`), so a picker never offers a
  resource the submit would reject.

The incident, maintenance, and SLO "affected systems" pickers now use
`useManageableResources` instead of duplicating that filtering logic.
