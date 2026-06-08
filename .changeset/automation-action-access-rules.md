---
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
"@checkstack/auth-backend": minor
"@checkstack/auth-common": minor
"@checkstack/ai-backend": minor
"@checkstack/ai-common": minor
"@checkstack/integration-common": minor
"@checkstack/integration-backend": minor
"@checkstack/integration-jira-common": minor
"@checkstack/integration-jira-backend": minor
"@checkstack/integration-teams-backend": minor
"@checkstack/integration-webex-backend": minor
---

feat(automation): gate integration actions on the runAs service account's permissions

**BREAKING.** Integration automation actions resolve credentials through a
trusted service rather than the bounded `runAs` client, so they previously
bypassed the runAs least-privilege model entirely: anyone able to author an
automation could create Jira tickets, send Teams/Webex messages, etc. on any
configured connection, with a zero-permission service account. This closes that
gap.

- **Actions declare `requiredAccessRules`** and the dispatch engine enforces
  them against the resolved `runAs` principal BEFORE the action runs (failing
  the step if missing) - the authorization point integration actions lacked.
- **Each integration plugin defines per-action access rules**, e.g.
  `integration-jira.create_issue.manage` / `search_issues.read` /
  `transition_issue.manage` / `add_comment.manage`,
  `integration-teams.post_message.manage`,
  `integration-webex.post_message.manage`.
- **`automation.propose` checks the same up front**, surfacing a per-action
  missing-permission error on the review card; `listActions` now exposes each
  action's `requiredAccessRules`, and `getBindableApplications` now returns each
  app's effective `accessRules`.
- **New `integration.read` rule** gates `listConnectionSummaries` /
  `resolveConnectionOptions` (previously open to any authenticated user), so
  discovering connections and resolving their field options requires a grant.
- **The AI assistant picks a capable runAs up front.**
  `automation.listServiceAccounts` now returns each account's `accessRules` and
  `automation.getCapabilitySchema` returns each action's `requiredAccessRules`,
  so the model selects a service account whose permissions cover the actions it
  uses instead of proposing and being rejected. When the operator did not name a
  runAs and more than one account qualifies, it ASKS which to use rather than
  choosing the automation's identity itself; when none has the needed rules it
  says which rule(s) to grant.

**Migration:** existing automations whose service account does not hold the new
rules will fail at the gated action until an admin grants the matching rule(s)
to the service account's role (e.g. add `integration-jira.create_issue.manage`).
Admin (`*`) service accounts are unaffected. Grant `integration.read` to roles
that author integration-using automations so the editor's connection pickers and
dropdowns keep working for non-admins.
