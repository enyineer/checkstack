---
"@checkstack/incident-frontend": patch
"@checkstack/slo-frontend": patch
---

Make the "active incidents" and "SLO" panels on the system overview use the
shared card design instead of thin banner strips.

Both panels rendered as flat `rounded-md` strips (`bg-card` / status-tinted
`bg-*/5`, `px-3 py-2`, no elevation) that looked inconsistent next to the
maintenance, dependencies, health-checks and anomaly cards. They now use the
same card recipe as those surfaces: `rounded-[var(--d-card-r)]`, the
`from-surface-2 to-surface` gradient, `p-[var(--d-pad)]`, and the shared panel
shadow.

- Incidents: matches its sibling maintenance banner - a status-colored left
  accent bar, a large count number, and an "active incident(s)" caption, with
  the severity pills preserved. Loading/empty states adopt the same rounding
  and border.
- SLO: becomes a proper card with a gradient surface, elevation, and an
  `h-4 w-4` icon + `text-sm font-semibold` header, with the objective rows
  aligned to the card padding.

Visual-only; no behavior, API, or data changes.
