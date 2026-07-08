---
"@checkstack/dependency-frontend": patch
---

Clarify the dependency impact chips on the system overview so they read as an
impact classification, not a live status.

The Dependencies panel showed a red "Critical" / amber "Degraded" pill next to
each neighbour, which - beside the live health dot and using the same status
colours - looked like the dependency was down or degraded right now. It actually
describes what the edge does to the system if the neighbour fails.

The chip now:

- Drops the status (red/amber) palette entirely - impact is a static edge
  attribute, so it uses a neutral chip ranked by emphasis, and the row's health
  dot stays the only colour-coded live signal.
- Uses impact-framed labels ("Critical impact", "Degrading impact",
  "Informational") instead of the bare status words.
- Leads with an impact icon (lightning / info) instead of a status dot.
- Carries a direction-aware tooltip spelling out the exact consequence with both
  system names, e.g. "Critical dependency. If Payments goes down, Checkout is
  treated as down." for an upstream edge, and the reverse for a "depended on by"
  edge.

The wording lives in a new pure `presentDependencyImpact` helper with unit tests.
No behavior, API, or data changes.
