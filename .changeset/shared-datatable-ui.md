---
"@checkstack/ui": minor
---

Add a shared `DataTable` component: column-driven click-to-sort headers, an
optional global search box, per-row presentation/behaviour via `getRowProps`
(including full keyboard/ARIA passthrough for interactive rows), a
`renderMobileCard` branch for narrow viewports, and an opaque `bg-card`
surface by default so tables stay readable over any page background. Powered
by `@tanstack/react-table` (new dependency) behind a fully-typed house API;
sorting is locale-aware/numeric with nullish values sorted last. Includes a
Storybook story and unit-tested sort/filter helpers.

Also add `RowActions` + `RowAction` - the one canonical style for a table row's
action buttons (a subtle, compact ghost icon button; `tone="destructive"` tints
it without a loud filled background), so actions look identical across every
data table.

BREAKING CHANGES: the `ResponsiveTable` and `MobileCardList` primitives are
removed - their dual-layout role is now internal to `DataTable`. Migrate table
call sites to `DataTable` (`renderMobileCard` replaces the paired
`MobileCardList`). For non-table responsive lists, use plain
`hidden sm:block` / `sm:hidden` wrappers.
