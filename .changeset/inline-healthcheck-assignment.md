---
"@checkstack/healthcheck-frontend": minor
---

Streamline system → healthcheck assignment flow by allowing in-context creation in both directions.

- Adds an "Assign to systems" multi-select section to the healthcheck create flow (new "Systems" tree node), so a fresh check can be wired to one or more systems in a single save.
- Adds a "+ Create new check" button on the system assignment IDE that opens the create flow pre-targeted at that system; on save, the new check is auto-assigned and the user is returned to the assignment IDE.
- Pre-selects the originating system when the create flow is entered with a `?systemId=` query param, and forwards that param through the strategy picker.
- Includes an info banner noting that health checks are reusable templates and can be assigned to additional systems at any time, to preserve the "configs are reusable" mental model.
