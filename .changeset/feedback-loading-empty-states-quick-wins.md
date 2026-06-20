---
"@checkstack/automation-frontend": minor
"@checkstack/status-page-frontend": minor
---

feat: live run polling, optimistic automation toggle, and relative public-status freshness

Implements three loading/feedback UX findings from the read-only review.

- **Automation run detail goes live.** `RunDetailPage` now polls
  `getRun` every 2s while the run is `running`/`waiting` and stops the
  moment it reaches a terminal status, so a watched execution updates
  its status badge and step timeline without a manual reload. A subtle
  "Live" indicator shows in the header while polling.
- **Optimistic automation enable/disable.** The per-row toggle on
  `AutomationListPage` now applies the documented optimistic pattern:
  `onMutate` cancels in-flight refetches, snapshots, and flips the row
  in the cache so the switch flips on click; `onError` rolls back from
  the snapshot and surfaces an error toast; `onSettled` invalidates to
  reconcile with server truth. The success toast is suppressed (the
  switch flip is the feedback), per `optimistic-updates.md`.
- **Relative, visibly-live public-status freshness.** The public status
  page renders "Updated x ago" as relative time (was a static absolute
  timestamp) and ticks periodically so the wording stays honest. A small
  refresh dot pulses on each successful 60s refetch (gated behind
  `usePerformance().isLowPower`, falling back to a static dot on
  low-power devices). The "auto-updates every minute" copy is unchanged.

BREAKING CHANGE: the automation enable/disable toggle no longer raises a
"<name> enabled/disabled" success toast; the optimistic switch flip is now
the sole success feedback (error toast retained on failure).
