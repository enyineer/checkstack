---
"@checkstack/dependency-frontend": patch
---

Improve form quality and accessibility of the dependency editor.

The "Depends on (upstream)" system picker and the impact-type select are now
associated with proper `<Label htmlFor>`/`id` pairings, so clicking a label
focuses its control and assistive tech announces the field name. Both mandatory
fields carry the `required` affordance (visible `*` plus screen-reader
"(required)"). Opening the add-dependency panel now autofocuses the system
picker so keyboard users can start selecting immediately. No behavioral change
beyond focus, labeling, and the required marker.
