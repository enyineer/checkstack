---
"@checkstack/maintenance-frontend": minor
"@checkstack/incident-frontend": minor
---

Name the single maintenance or incident on the system overview cards

When a system has exactly one leading maintenance window (or one active
incident), its card now shows the TITLE, linked to the record, instead of the
count. A bare "1" told the reader nothing they could not already infer from the
card being there, and forced a second click to learn anything.

With two or more there is no single thing to name, so the count remains.
