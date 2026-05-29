---
"@checkstack/integration-jira-backend": minor
"@checkstack/integration-teams-backend": minor
"@checkstack/integration-webex-backend": minor
"@checkstack/integration-webhook-backend": minor
"@checkstack/integration-script-backend": minor
"@checkstack/automation-backend": minor
---

fix(automation): qualify action `produces` / `consumes` with the owning plugin id

`context.artifacts` showed up untyped (no fields) in the script editor
because action `produces` / `consumes` were hand-written full strings
(`"jira.issue"`) that did not match the artifact-type registry's
qualified id. The registry derives `${pluginId}.${id}`, and the plugin's
id is the package name `integration-jira`, so the artifact type actually
registers as `integration-jira.issue` — the editor's schema lookup
(`produces` vs registered `qualifiedId`) missed, leaving the artifact's
fields unknown. (Runtime store/consume happened to agree with each other
on the short string, so it "worked" but typed nothing.)

The action registry now qualifies `produces` with the owning plugin id,
exactly as it already qualifies the action's own `id` and as the
artifact-type registry qualifies the artifact type id — so the three can
never drift. Actions declare the **local** artifact id:

- `produces: "issue"` → registered as `integration-jira.issue`,
- `consumes: ["issue"]` → resolved against the owning plugin's namespace
  at run time; `consumedArtifacts` is keyed by the local id, so an
  action's `execute` reads `consumedArtifacts["issue"]`.

All five artifact-producing integration plugins (jira / teams / webex /
webhook / script) now declare local ids. With `produces` matching the
registered artifact type, the editor types `context.artifacts[...]` with
the real schema (e.g. `issueKey`, `projectKey`, `issueUrl`).

**BREAKING (beta):** the fully-qualified artifact type ids change from
the short form to the plugin-prefixed form, e.g. `jira.issue` →
`integration-jira.issue`. This affects how artifacts are referenced in
templates (`{{ artifact.integration-jira.issue.issueKey }}`), the TS
script `context.artifacts["integration-jira.issue"]`, and shell env names
(`$CHECKSTACK_ARTIFACT_INTEGRATION_JIRA_ISSUE_ISSUEKEY`). Artifacts are
per-run and ephemeral, so no stored-data migration is needed.

Note: this keeps the same-plugin produce→consume handoff (the current
pattern). Cross-plugin artifact consumption would need a follow-up to
allow a fully-qualified `consumes` ref.
