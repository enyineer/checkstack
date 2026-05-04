---
"@checkstack/anomaly-common": minor
"@checkstack/anomaly-backend": minor
"@checkstack/anomaly-frontend": minor
---

Remove global anomaly settings — configuration is now field-only.

`AnomalySettings` (template- and assignment-level) no longer carries
`sensitivity`, `confirmationWindow`, `driftEnabled`, or `driftThreshold`.
These were duplicating the per-field configuration path with awkward
cascade semantics, and a single global multiplier was meaningless across
fields with different units (ms, %, counts).

The schema retains only the truly global concerns:

- `enabled` — master kill switch for the assignment
- `baselineWindow` — there is one history per system, not per field
- `notify` — one notification preference per assignment
- `fieldOverrides` — per-field configuration (where everything else now lives)

`resolveEffectiveConfig` collapses to two layers: field override → schema
default → engine fallback constant. The plugin-author defaults set via
`x-anomaly-*` annotations now drive sensitivity/window/drift across the
detector and drift evaluator (previously only floors were threaded
through the schema layer).

**Breaking changes:**

- Any global `sensitivity`/`confirmationWindow`/`driftEnabled`/
  `driftThreshold` values previously stored in `anomaly_configurations`
  or `anomaly_assignments` are silently stripped on parse. Users who
  customized these globals will revert to the plugin's tuned per-field
  defaults; if they want to keep those values they must re-apply them
  per field in the new UI.
- `AnomalySettingsForm` no longer renders the global sliders. The form
  now shows: enable toggle, baseline window selector, notify toggle,
  field overrides editor.
- `AnomalyFieldOverridesEditor` props `defaultSensitivity`,
  `defaultConfirmationWindow`, `defaultDriftEnabled`, `defaultDriftThreshold`
  are removed. Engine fallbacks (1.0, 3, true, 2) are now hard-coded
  internal constants used only when neither field override nor schema
  default is set.
- The GitOps `System.anomaly` entry schema (in `anomaly-gitops-kinds`)
  drops `sensitivity`, `confirmationWindow`, `driftEnabled`, and
  `driftThreshold` to match the new `AnomalySettings` shape. YAML files
  declaring those fields will be rejected at parse time — operators
  must move per-field tuning into `fieldOverrides`.

This change makes the override model trivial to explain ("plugin defaults,
overridden per field") and removes a class of confusing "where did this
threshold come from?" questions.
