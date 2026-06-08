---
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
---

Add an example-automation template catalogue. Creating a new automation now
opens a picker (`/automation/new`) with curated, ready-to-use starting points
grouped by category, plus a "Blank automation" option. Selecting a template
seeds the editor (the operator still chooses a service account and saves).

Templates are an extensible registry: external plugins contribute their own via
the new `automationTemplateExtensionPoint`, exactly like actions / triggers /
artifact types. Every registered template is validated against the LIVE
trigger/action/artifact registries at server startup - a template that
references a capability that is not installed is withheld with a console
warning, and one whose definition no longer validates (interface drift) is
withheld with a console error - so a template can never silently drift when an
action, trigger, condition, or artifact interface changes.

Ships five built-in templates spanning incident response and alerting
(AI-triage-and-file-Jira-bug, close-Jira-on-recovery, AI-summarize-incident,
page-on-call-on-sustained-degradation, AI-severity-escalation).
