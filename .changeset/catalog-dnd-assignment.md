---
"@checkstack/catalog-frontend": minor
---

Replace dropdown-based system-to-group assignment with drag-and-drop.

- Systems panel now shows a grip handle on each row for drag-and-drop onto groups
- Group panel cards highlight as valid drop zones when a system is dragged over them
- Dragging a system onto a group it already belongs to is blocked with a visual indicator
- Added a `+` popover button on each system row as a mobile-friendly alternative (no drag required on small screens)
- Touch sensor activated with 250ms delay to avoid conflicts with scrolling
- Removed the "Add System to Group" card with dropdowns
- Systems not assigned to any group display an `unassigned` badge
