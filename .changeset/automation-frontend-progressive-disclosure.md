---
"@checkstack/automation-frontend": minor
---

Add progressive disclosure and a live system picker to the automation visual editor.

The saved `definition` is unchanged - only the editor layout - so the visual and YAML views still round-trip losslessly.

- Triggers: the event picker and trigger config stay prominent; the optional `id`, gating `filter`, and `for:` dwell move into a per-trigger "Advanced" disclosure that auto-opens when a filter or dwell is set.
- Actions: per-action metadata (`id`, `description`, `continue_on_error`) moves into an "Advanced" disclosure inside the action card so the action's own configuration leads. Enable/disable stays on the card header.
- Conditions: the kind selector is grouped so the structured kinds (`numeric_state` / `time` / `state`) lead, the logical combinators follow, and the raw-expression escape hatch is de-emphasised under "Advanced" - all kinds stay reachable.
- The `state` condition's `entity` is now a live system picker backed by the catalog `getSystems` RPC, with a manual-entry fallback so an id not in the catalog (or a `{{ template }}`) still round-trips losslessly.
