---
"@checkstack/catalog-frontend": minor
---

Clone systems and environments

Systems and environments gained a **Clone** row action, which opens the editor
pre-seeded from the source record and saves as a create.

The clone is deliberately SHALLOW: name (suffixed), description and custom
fields only. Group and environment memberships, tags, contacts, links, team
grants and health-check assignments are NOT copied, and the dialog says so.
Duplicating health-check assignments in particular would silently multiply probe
volume and notification noise with every clone.

Cloning is gated on CREATE, not on manage of the source, and a GitOps lock on
the source does not block it - the copy is a new, unmanaged record.
