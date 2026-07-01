---
"@checkstack/announcement-frontend": patch
---

Give the Edit and Delete row actions on the announcement management page
accessible names (`aria-label`). The icon-only buttons previously exposed no
accessible name, so assistive technology announced them only as "button" and
tests had to target them positionally - which broke once the reorder Move
up/down controls were added to the same action group. The buttons now read as
"Edit announcement" / "Delete announcement".
