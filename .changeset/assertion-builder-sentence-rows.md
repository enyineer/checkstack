---
"@checkstack/healthcheck-frontend": minor
"@checkstack/ai-backend": patch
---

Redesign the assertion builder for readability by non-technical operators.
Conditions now read as sentences with inline controls -
"[Response Time] must [be less than] [500] ms" - driven by the collector
metadata that already powers the auto-charts:

- Field names come from `x-chart-label` (with a humanized fallback) instead
  of machine-derived paths like "Body → Status"; nested fields compose as
  "TLS › Days Left".
- Numeric values render their `x-chart-unit` suffix; boolean conditions use
  the collector's `x-chart-true-label`/`x-chart-false-label` prose ("must be
  successful" instead of "Is True").
- The field picker sorts by `x-chart-priority` and groups JSONPath fields
  under "Advanced" (with an inline expression input and example help);
  "Add condition" seeds the highest-priority field instead of the first one.
- Incomplete conditions (missing value, invalid regex, blank JSONPath) show
  an inline explanation and block Save through the editor's existing
  validity plumbing; duplicate conditions get a hint.
- Persisted data is untouched: field paths, operator strings, and the
  `CollectorAssertion` shape are byte-for-byte unchanged, so existing checks
  round-trip as-is. The builder is now typed against `CollectorAssertion`
  directly (the duplicated local `Assertion` type and its casts are gone),
  and the dead `CollectorList` component was removed.

The `@checkstack/ai-backend` patch is the regenerated docs index for the
documentation pages updated in this release (assignment flow, assertions,
and the slimmed system/incident/maintenance edit dialogs).
