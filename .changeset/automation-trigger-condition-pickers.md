---
"@checkstack/automation-frontend": minor
---

Add type-picker modals for the automation editor's Triggers and Conditions sections, matching the Actions "Add step" picker.

Instead of immediately creating a default element, both sections now open a searchable, grouped picker dialog so the operator chooses the type up front. The "Add" button moves out of each card's header to a bottom button styled exactly like the Actions "+ Add step" button.

- Triggers: a new "Add trigger" picker over the registry's trigger events (grouped by category, searchable). On pick the trigger is created with a unique default id (deduped against siblings) and appended.
- Conditions: a new "Add condition" picker over the condition kinds (grouped Structured / Logical / Advanced, searchable). On pick a schema-seeded default for that kind is appended.
- The shared `PickerRow`, add button and search input are extracted into a reusable `picker-dialog` module; `AddActionDialog` now consumes them.
- Condition kinds gain a `CONDITION_KIND_META` registry (label, description, icon, group) as the single source of metadata for the picker.
- Since the type is now chosen up front, the redundant in-sheet selectors are removed: the trigger config sheet drops its editable "Event" dropdown (keeping a read-only owner/description context line), and the top-level condition sheet drops its kind selector (swap kind = delete + re-add). Nested combinator clauses and the action `condition`-guard body keep their inline kind selector.
- New automations now start empty (no pre-filled trigger or action); the empty-state hints guide the operator to add a trigger and steps via the pickers.

The saved `definition` is unchanged - only how items are added - so the visual and YAML views still round-trip losslessly. Triggers and conditions remain non-reorderable.
