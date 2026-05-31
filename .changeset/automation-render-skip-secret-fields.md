---
"@checkstack/automation-backend": minor
---

fix(automation): preserve `${{ secrets.NAME }}` references in secret config fields during dispatch

The dispatch engine renders an action's `config` through the `{{ }}` template
engine before validating it. The secret-reference syntax `${{ secrets.NAME }}`
embeds `{{ secrets.NAME }}`, so the engine evaluated that inner expression
against a scope with no `secrets`, collapsing the value to `$` and failing
config validation (`invalid_union` on the secret field) for any real run that
used a `secretEnv` mapping or an `x-secret` field. The in-UI "Test Script"
path was unaffected because it never renders config.

`renderConfig` now passes fields annotated `x-secret` or `x-secret-env` through
verbatim (the same treatment as native-code `x-editor-types` fields), so the
secret reference reaches the secret resolver intact. Resolution and output
masking are unchanged.
