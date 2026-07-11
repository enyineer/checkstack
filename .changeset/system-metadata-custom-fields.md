---
"@checkstack/backend-api": minor
"@checkstack/catalog-backend": minor
"@checkstack/catalog-common": patch
"@checkstack/catalog-frontend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/healthcheck-script-backend": minor
"@checkstack/satellite": minor
"@checkstack/satellite-common": minor
"@checkstack/ui": minor
"@checkstack/ai-backend": minor
---

Make a catalog System's free-form `metadata` (custom fields) genuinely usable
end to end, mirroring how Environment custom fields already work. Previously a
System's `metadata` column was writable but nothing consumed it - it did not
surface in templating, could not be set via GitOps, and had no UI editor, so
models (and users) had no way to understand what it was for.

Now a system's custom fields are surfaced everywhere an environment's already
are:

- **Config templating**: a system's fields render as
  `{{ system.metadata.<key> }}` in templatable health-check config (e.g. an
  HTTP URL). They are namespaced under `.metadata` so a field named `id`/`name`
  can never shadow the structural `{{ system.id }}` / `{{ system.name }}`.
- **Satellites**: the fields ride the satellite assignment
  (`SatelliteAssignment.systemMetadata`) so satellite runs template
  `{{ system.metadata.<key> }}` identically to local runs.
- **UI**: the System editor gains a free-form key/value custom-fields editor
  (extracted into a shared `CustomFieldsEditor` used by both the System and
  Environment editors).
- **GitOps**: the `System` kind accepts optional `spec.fields`, replaced on
  every reconcile (same shape as the `Environment` kind).
- **Script collectors**: inline TS collectors read `context.system.metadata`
  (SDK editor types updated), and shell collectors get one
  `CHECKSTACK_SYSTEM_<FIELD>` env var per field, mirroring
  `CHECKSTACK_ENV_<FIELD>`. A field that normalizes to a reserved name
  (`CHECKSTACK_SYSTEM_ID`/`_NAME`) is now skipped with a warning rather than
  clobbering the built-in; the same reserved-name guard was added to the
  environment shell-env builder (previously a custom field named `id`/`name`
  could shadow the structural var).
- **Editor autocomplete/preview**: the health-check editor offers
  `{{ system.metadata.<key> }}` completions and previews their values when a
  concrete system is in context.

The AI assistant is corrected on two fronts:

- The catalog create/update-system (and create-environment) tool schemas now
  `.describe()` their `metadata` field, so a model knows it is free-form custom
  fields that surface in templating - not a tagging/labeling mechanism - and
  should only set keys the user explicitly asks for.
- A new "Acting on requests" chat system-prompt rule tells the assistant to
  perform a requested change via its tool instead of deflecting to a manual
  GitOps/UI how-to, and to name the missing permission when a tool is genuinely
  unavailable. (This entry also covers the regenerated docs index reflecting the
  updated GitOps/templating docs.)

State & scale: a system's metadata continues to live solely in the
`catalog.systems.metadata` Postgres column and is read via the existing
`getSystem` RPC, so every pod reads the same value. The satellite assignment
carries a per-dispatch snapshot for the duration of that run (ephemeral,
re-read on the next dispatch), not a second source of truth. No new table or
migration.
