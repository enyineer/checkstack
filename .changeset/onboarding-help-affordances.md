---
"@checkstack/frontend": minor
"@checkstack/tips-frontend": minor
"@checkstack/dashboard-frontend": minor
---

Add persistent in-app help and a fresh-install getting-started checklist.

- A persistent help affordance now lives in the navbar: a "?" icon button
  (accessible name "Help and documentation") opens a popover (sheet on mobile)
  containing a Documentation link to the user guide, a "Show tips again" action,
  and a one-line legend explaining the lightbulb (concept tip) vs tooltip
  (affordance hint) convention. Help is now reachable from every page rather
  than only via the sidebar's Docs link.
- The documented "replay onboarding" capability is now wired: a new
  `useResetAllTips` hook in `@checkstack/tips-frontend` calls `TipsApi.reset`
  with no ids (clearing every dismissed tip for the user, server + localStorage),
  surfaced as the help menu's "Show tips again" action with a confirmation toast.
- The dashboard now shows a dismissable "Getting started" checklist on fresh
  installs (zero catalog systems, derived from the existing entities query - no
  new queries). It links the next three steps: add a system, attach a health
  check, connect a notification channel. Dismissal persists per-user via the
  tips dismissal mechanism and is restorable from the help menu. The existing
  "Nothing to show on the dashboard yet" empty state is unchanged.
