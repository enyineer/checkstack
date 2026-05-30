---
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
---

feat(automation): reference artifacts by explicit action id (`artifacts.<id>.<name>`)

Multiple actions of the same type (e.g. two "create Jira issue" steps) used
to collide: both produced the artifact type `integration-jira.issue`, so a
template could only ever reach "the most recent one of that type". Artifacts
are now addressed by the producing action's instance `id` instead.

- Templates reference a produced artifact solely as
  `{{ artifacts.<actionId>.<localArtifactName>.<field> }}`, e.g.
  `{{ artifacts.open_jira.issue.issueKey }}`. The local artifact name is the
  producing action's `produces` id with the owning plugin prefix stripped
  (`integration-jira.issue` -> `issue`).
- `@checkstack/automation-backend`: the dispatch engine nests each produced
  artifact under `artifacts[actionId][localName]` in the template scope and
  records the `actionId` on the artifact row. `validate-definition` now
  enforces that action ids are unique within an automation and that every
  artifact-producing action carries an id.
- `@checkstack/automation-common`: action `id` is constrained to an
  identifier (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`) so it is always usable as a
  plain template segment. The variable-scope resolver surfaces
  `artifacts.<id>.<name>` (with full field completion) in the editor.
- `@checkstack/automation-frontend`: the action editor now has editable `Id`
  and `Description` inputs (previously settable only via the YAML view), and
  new steps get an auto-assigned, unique, log-friendly default id that the
  operator can rename. Action ids are recorded on every run step, so run
  logs are parseable by id regardless of kind.

**BREAKING (beta):** the previous flat, type-keyed scope form
`{{ artifacts["integration-jira.issue"] }}` is removed. Reference artifacts
by the producing action's id instead. Action ids may no longer contain
hyphens or dots (identifier characters only). Artifacts are per-run and
ephemeral, so no stored-data migration is needed.
