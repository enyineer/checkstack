---
"@checkstack/announcement-frontend": patch
"@checkstack/gitops-frontend": patch
"@checkstack/ui": patch
"@checkstack/status-page-frontend": patch
---

Improve small-viewport layout and touch targets across several admin surfaces.

The announcement editor's two `grid grid-cols-3` form rows (Severity / Visibility
/ Display Mode and Status / Starts / Expires) now stack with
`grid-cols-1 sm:grid-cols-3`, so the three `Select` controls are no longer
crushed into ~100px columns inside the dialog on a phone. The GitOps provenance
summary cards switch from a fixed `grid-cols-4` to `grid-cols-2 sm:grid-cols-4`
so the counts and labels do not overflow at narrow widths.

The shared `IDELayout` now becomes two-pane at `md` instead of only `lg`, giving
tablets a side-by-side tree + editor, and the `IDEStatusBar` issue list now wraps
(`flex-wrap`) instead of hiding issues behind a horizontal scroll.

Inline icon-only action buttons that previously used `size="sm"` (36px tall) now
use `size="icon"` (40px square) to meet touch-target guidance: the announcement
table/card edit and delete actions, and the status-page builder block
move-up/move-down/remove actions. These are styling-only changes with no behavior
or layout-structure changes beyond the responsive breakpoints noted above.
