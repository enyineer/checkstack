---
"@checkstack/automation-frontend": minor
"@checkstack/ui": minor
---

Redesign the automation visual editor to a Home-Assistant-style collapsed-card UX.

Every item in all three sections (actions, triggers, conditions) now renders as a compact summary row by default - icon, title, and a one-line summary derived from its config. Clicking the row opens the item's full configuration in a right-side sheet that edits the same live definition (no draft/commit step), so closing the sheet keeps the changes. The saved `definition` is unchanged - only the editor presentation - so the visual and YAML views still round-trip losslessly.

- `@checkstack/ui` `ActionCard` gains three optional, backward-compatible props: `onOpenSheet` (turns the card into a non-expanding summary row that opens a host-supplied sheet on header click), `summary` (the compact one-line hint shown under the title), and `actions` (a typed `ActionCardMenuItem[]` rendered as a three-dot overflow menu). The new `ActionCardMenuItem` type is exported. Existing inline-expand usages are unaffected when the new props are omitted.
- Per-card commands move into the overflow menu: Disable/Enable, a new Duplicate, and Delete. The drag grip stays on the action card header; actions keep dnd-kit reordering and the parallel id array. Triggers and conditions remain non-reorderable.
- Duplicate clones an item with fresh, unique ids (via the existing id helpers) and inserts it directly after the original, keeping the editor's parallel id array in sync.
- Composite actions (choose / parallel / repeat / sequence) keep nesting: a child card inside a parent's sheet opens its OWN sheet, stacking via Radix Dialog's portal + overlay.
- Cards with validation errors auto-open their sheet and show an error badge on the collapsed row, so problems are never hidden behind a collapsed row plus a closed sheet.
