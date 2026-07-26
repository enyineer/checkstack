---
"@checkstack/common": minor
"@checkstack/backend": patch
"@checkstack/healthcheck-common": patch
"@checkstack/auth-common": patch
"@checkstack/status-page-common": patch
"@checkstack/incident-common": patch
"@checkstack/maintenance-common": patch
"@checkstack/metricstream-common": patch
"@checkstack/tracestream-common": patch
"@checkstack/logstream-common": patch
"@checkstack/automation-common": patch
"@checkstack/api-docs-frontend": patch
---

Make endpoint authorization self-documenting in the generated API docs

Every procedure's authorization is now derived from its contract metadata (its
`access` rules + `instanceAccess` mode) via a shared mode-descriptor registry and
emitted into the OpenAPI spec - both structurally (`x-orpc-meta.authorization`)
and as a human `**Authorization.**` sentence folded into the operation
description. Previously the docs surfaced only a flat list of global rule ids, so
an integrator (an API-key/application principal that CAN hold team grants) never
saw the team-grant / per-object dimension, and endpoints gated purely in the
handler showed no restriction at all.

For authorization that no declarative mode can express and is therefore enforced
in the handler (a compound OR, a graded verdict, a DB-derived id set), a new
optional `accessNote` on the procedure metadata surfaces the real rule in the
docs as an explicitly handler-enforced addendum. The note is documentation, not a
guarantee: per `.claude/rules/rlac.md` the drift guard for such authz is
behavioral tests over an extracted pure decision function, and the note must
state exactly what those tests pin.

Every handler-enforced authorization endpoint now carries such a note so the docs
are complete: the team read/scoping and team-management endpoints
(`@checkstack/auth-common`), the health-check assignment/history reads
(`@checkstack/healthcheck-common`), the audience-graded incident/maintenance
reads (`@checkstack/incident-common`, `@checkstack/maintenance-common`), status
-page publish's bound-resource check (`@checkstack/status-page-common`), the
stream `setSystemLinks` readable-additions check
(`@checkstack/{metricstream,tracestream,logstream}-common`), and the automation
`runAs` escalation guard (`@checkstack/automation-common`). These are
metadata-only additions - no runtime behavior changed. The notes describe the
rule for API-doc readers only; the drift guard is behavioral tests over the
check's decision function (per `.claude/rules/rlac.md`), so the notes name no
internal test files.

The API docs viewer (`@checkstack/api-docs-frontend`) now renders each
operation's description as Markdown, so the `**Authorization.**` block (and any
inline `code`) formats correctly instead of showing raw markdown.
