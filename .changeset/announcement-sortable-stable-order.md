---
"@checkstack/announcement-backend": minor
"@checkstack/announcement-common": minor
"@checkstack/announcement-frontend": minor
---

Announcements now have a stable, operator-controlled display order.

## What changed

- **Stable ordering (bugfix).** `getActiveAnnouncements` had no `ORDER BY`, so
  Postgres returned rows in heap order, which shifts after any `UPDATE` - that
  is why announcements jumped position whenever one was edited. Both
  `getActiveAnnouncements` and `listAllAnnouncements` now order by
  `sort_order`, with `created_at` and `id` as stable tiebreakers, so the
  sequence never changes on its own.
- **Manual sorting.** `announcements` gained a `sort_order` integer column
  (migration `0001`, back-filled from existing creation order). A new
  `reorderAnnouncements` admin procedure takes the full ordered id list and
  writes each announcement's position in one atomic `UPDATE ... CASE`. Operators
  reorder from the management page with per-row up/down arrows (desktop table
  and mobile cards). New announcements append at the end; editing an
  announcement never moves it.
- **Pure manual order everywhere.** The public banner no longer force-sorts by
  severity - banner, dashboard, and admin list all render the operator's order.
- The `announcement.updated` signal payload's `action` gained a `"reordered"`
  value so listeners refetch after a reorder.

## Notes

- `sort_order` is backend-internal; it is not exposed on the public
  `Announcement` schema (the frontend derives order from query order).
- Migration `0001_typical_omega_red.sql` adds the column (default `0`) and
  back-fills distinct values via `row_number()` over `created_at, id`. It
  applies cleanly to both fresh and already-populated databases.
